const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from('enc:' + s),
        decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^enc:/, ''),
      },
    };
  }
  return origLoad.apply(this, arguments);
};
