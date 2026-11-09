import {randomBytes, createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {isIP} from 'node:net';
import {createWpsStore} from './wps.js';
import {createCaptureStorage} from './office-capture-storage.js';

const API = '/api/contract-review-studio/';
const MAX = 44 * 1024 * 1024;
const noStore = {'cache-control': 'no-store'};

export function normalizeOfficeServiceUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw Error('请填写交付人员提供的文档服务链接');
  let url;
  try { url = new URL(value.trim()); } catch { throw Error('服务链接格式不正确，请填写完整的 HTTPS 地址'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const privateHost = host === 'localhost' || host === '::1' || isIP(host) === 4 && (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost)) throw Error('公网服务必须使用 HTTPS；HTTP 仅支持本机或公司内网地址');
  if (url.username || url.password || url.search || url.hash) throw Error('链接不能含账号密码、查询参数或片段；访问凭证请单独填写');
  url.pathname = url.pathname.replace(/\/(?:api\/contract-review-studio\/onlyoffice\/status|health)\/?$/, '').replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

export function registerOfficeConnection(ctx, registerLocal, legacyService = '') {
  const home = process.env.DSH_HOME || join(process.env.APPDATA || '.', 'dsh-desktop/harness');
  const directory = join(home, 'contract-review-studio');
  const configPath = join(directory, 'office-service-connection.json');
  const localRoutes = [];
  const serviceGet = (target, key) => { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; };
  const localWeb = new Proxy(ctx.webServer, {get(target, key) { return key === 'register' ? route => localRoutes.push(route) : serviceGet(target, key); }});
  const localFetch = new Proxy(ctx.connection.fetch, {get(target, key) { return key === 'register' ? route => localRoutes.push({...route, kind: 'fetch'}) : serviceGet(target, key); }});
  const localConnection = new Proxy(ctx.connection, {get(target, key) { return key === 'fetch' ? localFetch : serviceGet(target, key); }});
  const localContext = new Proxy(ctx, {get(target, key) {
    if (key === 'effect') return callback => callback();
    if (key === 'webServer') return localWeb;
    if (key === 'connection') return localConnection;
    return serviceGet(target, key);
  }});
  registerLocal(localContext);
  let queue = Promise.resolve();
  const serial = callback => { const operation = queue.catch(() => {}).then(callback); queue = operation.catch(() => {}); return operation; };
  async function readConfig() {
    try {
      const value = JSON.parse(await readFile(configPath, 'utf8'));
      if (value.url) return {url: normalizeOfficeServiceUrl(value.url), token: checkToken(value.token), configured: true};
      return {url: '', token: '', configured: true};
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('文档服务配置读取失败，请重新保存配置');
      return {url: legacyService ? normalizeOfficeServiceUrl(legacyService) : '', token: '', configured: false};
    }
  }
  function checkToken(value) {
    if (typeof value !== 'string' || !value || value.length > 2048 || /[\r\n\x00-\x1f\x7f]/.test(value)) throw Error('访问凭证格式不正确');
    return value;
  }
  async function automaticToken() {
    await mkdir(directory, {recursive: true});
    const file = join(directory, 'shared-office-access.key');
    try { await writeFile(file, randomBytes(32).toString('hex'), {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return checkToken((await readFile(file, 'utf8')).trim());
  }
  async function candidate(input) {
    const url = normalizeOfficeServiceUrl(input.url);
    const current = await readConfig();
    const token = input.token ? checkToken(input.token) : current.url === url && current.token ? current.token : current.url === url && !current.configured ? await automaticToken() : randomBytes(32).toString('hex');
    return {url, token};
  }
  async function persist(config) {
    await mkdir(directory, {recursive: true});
    const temporary = configPath + '.' + randomBytes(8).toString('hex') + '.tmp';
    await writeFile(temporary, JSON.stringify(config), {mode: 0o600});
    await rename(temporary, configPath);
  }
  async function remote(config, route, method = 'GET', body, timeout = 90000) {
    const token = config.token || await automaticToken();
    return fetch(config.url + route, {
      method,
      headers: {'authorization': 'Bearer ' + token, 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body}),
      signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
  }
  async function check(config) {
    let response;
    try { response = await remote(config, API + 'onlyoffice/status', 'GET', undefined, 12000); }
    catch { throw Error('服务连接失败，请检查链接、客户网络或联系交付人员'); }
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw Error('服务拒绝访问，请核对交付人员提供的访问凭证'); }
    if (!response.ok) { await response.body?.cancel(); throw Error('文档服务不可用（HTTP ' + response.status + '），请检查链接是否为文档接入服务'); }
    let status;
    try { status = await response.json(); } catch { throw Error('此链接没有返回有效的文档服务状态，请填写文档接入服务链接'); }
    if (status.ready !== true || status.serviceReady !== true) throw Error('已找到服务，但编辑器或回传连接尚未就绪，请联系交付人员');
    return {ready: true, serviceReady: true, editorUrl: typeof status.editorUrl === 'string' ? status.editorUrl : null};
  }
  const json = (res, status, data) => { res.writeHead(status, {'content-type': 'application/json;charset=utf-8', ...noStore}); res.end(JSON.stringify(data)); };
  async function requestBody(req, max = MAX) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > max) throw Error('请求超过大小限制'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  ctx.effect(() => ctx.webServer.register({kind: 'exact', path: API + 'onlyoffice/connection', async handler(req, res) {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined) return json(res, rejection, {error: '请在 DSH 工作台中配置'});
    try {
      if (req.method === 'GET') {
        const config = await readConfig();
        return json(res, 200, {url: config.url, authorized: !!config.token, mode: config.url ? 'remote' : 'local', inherited: !config.configured, hasLegacyDefault: !!legacyService});
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, {error: '方法不支持'}); }
      const input = JSON.parse(await requestBody(req, 8192));
      if (input.action === 'reset') {
        const config = await serial(async () => {
          const next = legacyService ? {url: normalizeOfficeServiceUrl(legacyService), token: await automaticToken()} : {url: '', token: ''};
          await persist(next); return next;
        });
        return json(res, 200, {saved: true, url: config.url, mode: config.url ? 'remote' : 'local'});
      }
      if (!['save', 'test'].includes(input.action)) throw Error('不支持的连接操作');
      const result = await serial(async () => {
        const config = await candidate(input);
        const status = await check(config);
        if (input.action === 'save') await persist(config);
        return {saved: input.action === 'save', url: config.url, ...status};
      });
      return json(res, 200, result);
    } catch (error) { return json(res, 400, {error: error.message || '配置操作失败'}); }
  }}));

  async function migrate(input) {
    const id = input.fileId || input.wpsFileId;
    if (!id) return input;
    const folder = input.wpsFileId ? 'wps-files' : 'onlyoffice-files';
    const disk = await createWpsStore(join(directory, folder));
    let meta;
    try { meta = await disk.read(id); } catch (error) { if (error.code === 'ENOENT') return input; throw error; }
    return {...input, fileId: undefined, wpsFileId: undefined, name: meta.name, base64: (await disk.bytes(meta.id, meta.version)).toString('base64')};
  }
  async function localSaved(route, query) {
    let bytes;
    const folder = join(directory, 'onlyoffice-files');
    if (route === 'office-saved') { const disk = await createWpsStore(folder), meta = await disk.read(query.get('fileId')); bytes = await disk.bytes(meta.id, meta.version); }
    else bytes = (await createCaptureStorage(folder).load(query.get('id'))).bytes;
    return new Response(bytes, {headers: {'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ...noStore, 'x-content-sha256': createHash('sha256').update(bytes).digest('hex')}});
  }
  for (const route of localRoutes) {
    if (route.kind === 'fetch') {
      ctx.connection.fetch.register({...route, async fetch(request) {
        const config = await readConfig();
        if (!config.url) return route.fetch(request);
        try {
          const url = new URL(request.url);
          const response = await remote(config, url.pathname + url.search, request.method, request.method === 'POST' ? await request.text() : undefined);
          if (response.status === 404 && request.method === 'GET') {
            try { const result = await localSaved(url.pathname.split('/').at(-1), url.searchParams); await response.body?.cancel(); return result; } catch {}
          }
          const headers = new Headers(noStore);
          for (const name of ['content-type', 'x-content-sha256']) {
            const value = response.headers.get(name); if (value) headers.set(name, value);
          }
          return new Response(await response.arrayBuffer(), {status: response.status, headers});
        } catch { return Response.json({error: '文档服务连接失败，请检查已配置链接或客户网络'}, {status: 502}); }
      }});
      continue;
    }
    if (route.path.startsWith(API + 'onlyoffice/')) {
      ctx.effect(() => ctx.webServer.register({...route, async handler(req, res) {
        const rejection = ctx.connection.requestRejection(req);
        if (rejection !== undefined) return json(res, rejection, {error: '请在 DSH 中打开'});
        const endpoint = route.path.split('/').at(-1);
        const method = endpoint === 'status' ? 'GET' : 'POST';
        if (req.method !== method) { res.setHeader('Allow', method); return json(res, 405, {error: '方法不支持'}); }
        try {
          const config = await readConfig();
          if (!config.url) return route.handler(req, res);
          let body;
          if (req.method === 'POST') { body = await requestBody(req); if (endpoint === 'session') body = JSON.stringify(await migrate(JSON.parse(body))); }
          const response = await remote(config, req.url, req.method, body, endpoint === 'status' ? 12000 : 90000);
          res.writeHead(response.status, {'content-type': 'application/json', ...noStore});
          return res.end(Buffer.from(await response.arrayBuffer()));
        } catch { return json(res, 502, {error: '文档服务连接失败，请检查已配置链接或客户网络'}); }
      }}));
    } else ctx.effect(() => ctx.webServer.register(route));
  }
}
