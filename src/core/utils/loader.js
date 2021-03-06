import Emitter from './emitter';

const ERROR_STATE = ['', 'ABORTED', 'NETWORK', 'DECODE', 'SRC_NOT_SUPPORTED'];

export default function Loader(url, deferLoad) {
    const emitter = new Emitter();

    let audioContext = null;
    let data = null;
    let isTouchLocked = false;
    let progress = 0;
    let request = null;
    let timeout = null;

    function removeListeners() {
        emitter.off();

        if (data && typeof data.removeEventListener === 'function') {
            data.removeEventListener('load', readyHandler);
            data.removeEventListener('canplaythrough', readyHandler);
            data.removeEventListener('error', errorHandler);
            data.onerror = null;
        }

        if (request) {
            request.removeEventListener('progress', progressHandler);
            request.removeEventListener('load', loadHandler);
            request.removeEventListener('error', errorHandler);
        }
    }

    function dispatchComplete(buffer) {
        emitter.emit('progress', 1);
        emitter.emit('loaded', buffer);
        emitter.emit('complete', buffer);

        removeListeners();
    }

    function progressHandler(event) {
        if (event.lengthComputable) {
            progress = event.loaded / event.total;
            emitter.emit('progress', progress);
        }
    }

    function errorHandler() {
        cancelTimeout();

        let status = '';

        if (request) {
            status = `${request.status} ${request.statusText}`;
        } else if (data && data.error) {
            status = ERROR_STATE[data.error.code];
        }

        if (emitter.listenerCount('error')) {
            emitter.emit('error', new Error(`Load Error: ${status} ${url}`));
        }

        removeListeners();
    }

    function cancelTimeout() {
        window.clearTimeout(timeout);
    }

    function decodeArrayBuffer(arraybuffer) {
        audioContext.decodeAudioData(arraybuffer, (buffer) => {
            data = buffer;
            request = null;
            progress = 1;
            dispatchComplete(buffer);
        },
        errorHandler
        );
    }

    function loadHandler() {
        if (request.status >= 400) {
            errorHandler();
            return;
        }
        decodeArrayBuffer(request.response);
    }

    function readyHandler() {
        cancelTimeout();
        if (!data) {
            return;
        }
        if (!data.readyState) {
            errorHandler();
            return;
        }
        progress = 1;
        dispatchComplete(data);
    }

    function cancel() {
        cancelTimeout();
        removeListeners();

        if (request && request.readyState !== 4) {
            request.abort();
        }
        request = null;
    }

    function destroy() {
        cancel();
        request = null;
        data = null;
        audioContext = null;
    }

    // audio buffer

    function loadArrayBuffer() {
        if (url instanceof window.ArrayBuffer) {
            decodeArrayBuffer(url);
            return;
        }
        request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.responseType = 'arraybuffer';
        request.addEventListener('progress', progressHandler);
        request.addEventListener('load', loadHandler);
        request.addEventListener('error', errorHandler);
        request.send();
    }

    // audio element

    function loadAudioElement() {
        if (!data || !data.tagName) {
            data = document.createElement('audio');
        }

        if (!isTouchLocked) {
            cancelTimeout();
            timeout = window.setTimeout(readyHandler, 3000);
            data.addEventListener('canplaythrough', readyHandler, false);
            data.addEventListener('load', readyHandler, false);
        }

        data.addEventListener('error', errorHandler, false);
        data.preload = 'auto';
        data.onerror = errorHandler;
        data.src = url;
        data.load();

        if (isTouchLocked) {
            dispatchComplete(data);
        }
    }

    function start(force = false) {
        if (!url || (deferLoad && !force)) {
            return;
        }
        if (audioContext) {
            loadArrayBuffer();
        } else {
            loadAudioElement();
        }
    }

    // reload

    function load(newUrl) {
        url = newUrl;
        start();
    }

    const api = {
        on: emitter.on.bind(emitter),
        once: emitter.once.bind(emitter),
        off: emitter.off.bind(emitter),
        load,
        start,
        cancel,
        destroy
    };

    Object.defineProperties(api, {
        data: {
            get: function() {
                return data;
            }
        },
        progress: {
            get: function() {
                return progress;
            }
        },
        audioContext: {
            set: function(value) {
                audioContext = value;
            }
        },
        isTouchLocked: {
            set: function(value) {
                isTouchLocked = value;
            }
        },
        url: {
            get: function() {
                return url;
            }
        }
    });

    return Object.freeze(api);
}

Loader.Group = function() {
    const emitter = new Emitter();
    const queue = [];
    let numLoaded = 0;
    let numTotal = 0;
    let currentLoader = null;

    function progressHandler(progress) {
        const loaded = numLoaded + progress;
        emitter.emit('progress', loaded / numTotal);
    }

    function completeHandler() {
        numLoaded++;
        removeListeners();
        emitter.emit('progress', numLoaded / numTotal);
        next();
    }

    function errorHandler(e) {
        removeListeners();
        if (emitter.listenerCount('error')) {
            emitter.emit('error', e);
        }
        next();
    }

    function next() {
        if (queue.length === 0) {
            currentLoader = null;
            emitter.emit('complete');
            return;
        }

        currentLoader = queue.pop();
        currentLoader.on('progress', progressHandler);
        currentLoader.once('loaded', completeHandler);
        currentLoader.once('error', errorHandler);
        currentLoader.start();
    }

    function removeListeners() {
        currentLoader.off('progress', progressHandler);
        currentLoader.off('loaded', completeHandler);
        currentLoader.off('error', errorHandler);
    }

    function add(loader) {
        queue.push(loader);
        numTotal++;
        return loader;
    }

    function start() {
        numTotal = queue.length;
        next();
    }

    return Object.freeze({
        on: emitter.on.bind(emitter),
        once: emitter.once.bind(emitter),
        off: emitter.off.bind(emitter),
        add,
        start
    });
};
