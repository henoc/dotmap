/* Native file dialogs and atomic writes. The injected host keeps tests DOM-free. */
(function (root) {
  'use strict';
  function createFileIO({ id, description, accept }, host = root) {
    const types = [{ description, accept }];
    return {
      canOpen: () => typeof host.showOpenFilePicker === 'function',
      canSave: () => typeof host.showSaveFilePicker === 'function',
      async openFiles(multiple = false) {
        const handles = await host.showOpenFilePicker({ id, multiple, types, excludeAcceptAllOption: true });
        return Promise.all(handles.map(async handle => ({ handle, file: await handle.getFile() })));
      },
      async saveTarget(name, existingHandle = null, startIn = null) {
        if (existingHandle) {
          if (await existingHandle.requestPermission({ mode: 'readwrite' }) !== 'granted')
            throw new Error('上書き保存の許可がありません。再度許可するか、「名前を付けて保存」で別の保存先を選んでください。');
          return existingHandle;
        }
        const options = { id, suggestedName: name, types, excludeAcceptAllOption: true };
        if (startIn) options.startIn = startIn;
        return host.showSaveFilePicker(options);
      },
      async write(handle, blob) {
        const writable = await handle.createWritable();
        try { await writable.write(blob); await writable.close(); }
        catch (error) {
          try { await writable.abort(); } catch { /* A failed close may already have closed the stream. */ }
          throw error;
        }
      },
    };
  }
  function filename(value, extension, fallback) {
    const name = String(value || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    return (name || fallback) + (name.toLowerCase().endsWith(extension) ? '' : extension);
  }
  const api = { createFileIO, filename };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EditorFileIO = api;
})(globalThis);
