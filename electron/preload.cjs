const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('pimkey', {
  vault: {
    status: invoke('vault:status'),
    create: invoke('vault:create'),
    unlock: invoke('vault:unlock'),
    unlockHello: invoke('vault:unlockHello'),
    lock: invoke('vault:lock'),
    changePassword: invoke('vault:changePassword'),
  },
  entries: {
    list: invoke('entries:list'),
    save: invoke('entries:save'),
    trash: invoke('entries:trash'),
    restore: invoke('entries:restore'),
    remove: invoke('entries:delete'),
    emptyTrash: invoke('entries:emptyTrash'),
    trashMany: invoke('entries:trashMany'),
    restoreMany: invoke('entries:restoreMany'),
    removeMany: invoke('entries:deleteMany'),
    tidyTitles: invoke('entries:tidyTitles'),
    duplicate: invoke('entries:duplicate'),
    favorite: invoke('entries:favorite'),
  },
  icon: {
    pick: invoke('icon:pick'),
    fromUrl: invoke('icon:fromUrl'),
    paste: invoke('icon:paste'),
    reset: invoke('icon:reset'),
    refresh: invoke('icon:refresh'),
    lookup: invoke('icon:lookup'),
    set: invoke('icon:set'),
  },
  secret: { reveal: invoke('secret:reveal') },
  clip: { copy: invoke('clip:copy'), copyTotp: invoke('clip:copyTotp'), copyHistory: invoke('clip:copyHistory') },
  totp: { code: invoke('totp:code') },
  history: { reveal: invoke('history:reveal') },
  hello: { status: invoke('hello:status'), enable: invoke('hello:enable'), disable: invoke('hello:disable'), confirm: invoke('hello:confirm') },
  audit: { breaches: invoke('audit:breaches') },
  importer: { pick: invoke('import:pick'), confirm: invoke('import:confirm'), cancel: invoke('import:cancel') },
  link: { open: invoke('link:open') },
  attachment: {
    add: invoke('attachment:add'),
    drop: invoke('attachment:drop'),
    preview: invoke('attachment:preview'),
    save: invoke('attachment:save'),
    remove: invoke('attachment:remove'),
  },
  backup: {
    export: invoke('backup:export'),
    pick: invoke('backup:pick'),
    restore: invoke('backup:restore'),
    status: invoke('backup:status'),
    now: invoke('backup:now'),
    setDir: invoke('backup:setDir'),
    openDir: invoke('backup:openDir'),
  },
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  bridge: {
    status: invoke('bridge:status'),
    enable: invoke('bridge:enable'),
    revoke: invoke('bridge:revoke'),
    answer: invoke('bridge:answer'),
    openDir: invoke('bridge:openDir'),
  },
  update: { status: invoke('update:status'), check: invoke('update:check'), install: invoke('update:install') },
  app: { info: invoke('app:info'), openData: invoke('app:openData'), activity: () => ipcRenderer.send('app:activity') },
  on(channel, cb) {
    const allowed = ['locked', 'entries', 'show', 'update', 'pair'];
    if (!allowed.includes(channel)) throw new Error(`Canal non autorisé : ${channel}`);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
