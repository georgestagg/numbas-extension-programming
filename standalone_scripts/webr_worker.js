const WEBR_URL = 'https://webr.r-wasm.org/v0.1.0/';
const PKG_URL = 'https://repo.r-wasm.org/';

// Load webR worker thread and add new communication channel
importScripts(`${WEBR_URL}webr-worker.js`);
chan = {
    setDispatchHandler: () => {},
    run: (args) => Module.callMain(args),
    setInterrupt: () => {},
    handleInterrupt: () => {},
    resolve: () => { self.resolve() },
    inputOrDispatch: () => 0,
    write: () => {},
}

self.webRPromise;
self.resolve;

async function loadWebR() {
    if(self.webRPromise) {
        return self.webRPromise;
    }
    self.webRPromise = new Promise(async (resolve,reject) => {
        self.resolve = resolve;
        init({
            RArgs: [],
            REnv: {
                R_HOME: '/usr/lib/R',
                R_ENABLE_JIT: '0',
            },
            WEBR_URL: WEBR_URL,
            PKG_URL: PKG_URL,
            homedir: '/home/web_user',
        });
    });
    return self.webRPromise;
}

self.namespaces = {};
self.get_namespace = function(id) {
    if(self.namespaces[id] === undefined) {
        self.namespaces[id] = new REnvironment();
        Module._Rf_protect(self.namespaces[id].ptr);
    }
    return self.namespaces[id];
}

self.onmessage = async (event) => {
    await loadWebR();
    switch(event.data.command) {
        case 'runR':
            const { job_id, code, namespace_id } = event.data;
            self.stdout = [];
            self.stderr = [];

            const namespace = self.get_namespace(namespace_id);
            const prot = { n: 0 };
            let ret = captureR(code, {
                env: { payloadType: 'ptr', obj: { type: 'environment', ptr: namespace.ptr } },
                withAutoprint: true,
                throwJsException: false
            });
            protectInc(ret, prot);
            try {
                let result = ret.get('result');
                let output = ret.get('output').toArray().map((out) => {
                    const type = out.get('type').toString();
                    const data = out.get('data');
                    if (type === 'stdout' || type == 'stderr') {
                        return { type: type, data: data.toString() };
                    } else if (type === 'warning' || type === 'message') {
                        return { type: 'stderr', data: data.get('message').toString() };
                    } else if (type === 'error') {
                        throw new Error(data.get('message').toString());
                    }
                });
                self.stdout = output.filter((out) => out.type=='stdout').map((out) => out.data);
                self.stderr = output.filter((out) => out.type=='stderr').map((out) => out.data);

                if(result !== undefined && result.type() == 'logical') {
                    result = result.toBoolean();
                }
                if(isRObject(result)) {
                    try {
                        result = result.toJs();
                    } catch(e) {
                        self.postMessage({
                            conversion_error: `Can't convert from type ${result.type}`,
                            result: null,
                            job_id,
                            unconverted_type: result.type,
                            stdout: self.stdout.join('\n'),
                            stderr: self.stderr.join('\n'),
                        })
                        return;
                    }
                }
                self.postMessage({
                    result,
                    job_id,
                    stdout: self.stdout.join('\n'),
                    stderr: self.stderr.join('\n'),
                });
            } catch (error) {
                self.postMessage({
                    error: error.message,
                    error_name: error.name,
                    job_id,
                    stdout: self.stdout.join('\n'),
                    stderr: self.stderr.concat([error.message]).filter(x=>x!='').join('\n'),
                });
            } finally {
                unprotect(prot.n);
            }
            break;
    }
};
