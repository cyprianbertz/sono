import context from './context';
import BufferSource from './source/buffer-source';
import Effects from './effects';
import Emitter from './utils/emitter';
import file from './utils/file';
import utils from './utils/utils';
import isSafeNumber from './utils/isSafeNumber';
import Loader from './utils/loader';
import AudioSource from './source/audio-source';
import MediaSource from './source/media-source';
import MicrophoneSource from './source/microphone-source';
import OscillatorSource from './source/oscillator-source';

export default class Sound extends Emitter {
    constructor(config) {
        super();

        this.id = config.id || null;

        this._context = config.context || context;
        this._destination = config.destination || this._context.destination;
        this._effects = new Effects(this._context);
        this._gain = this._context.createGain();
        this._config = config;

        this._data = null;
        this._isTouchLocked = false;
        this._loader = null;
        this._loop = false;
        this._playbackRate = 1;
        this._playWhenReady = null;
        this._source = null;
        this._wave = null;

        this._effects.setDestination(this._gain);
        this._gain.connect(this._destination);

        this._onEnded = this._onEnded.bind(this);
        this._onLoad = this._onLoad.bind(this);
        this._onLoadError = this._onLoadError.bind(this);
    }

    load(newConfig = null, force = false) {
        const skipLoad = !force && !this._source && !!this._config.deferLoad;

        if (newConfig) {
            const configSrc = newConfig.src || newConfig.url || newConfig.data || newConfig;
            const src = file.getSupportedFile(configSrc) || this._config.src;
            this._config = Object.assign(this._config, newConfig, {src});
        }

        if (this._source && this._data && this._data.tagName) {
            this._source.load(this._config.src);
        } else {
            this._loader = this._loader || new Loader(this._config.src, skipLoad);
            this._loader.audioContext = !!this._config.asMediaElement || this._context.isFake ? null : this._context;
            this._loader.isTouchLocked = this._isTouchLocked;
            this._loader.off('loaded', this._onLoad);
            this._loader.once('loaded', this._onLoad);
            this._loader.off('error', this._onLoadError);
            this._loader.on('error', this._onLoadError);
        }
        return this;
    }

    play(delay, offset) {
        if (!this._source || this._isTouchLocked) {
            this._playWhenReady = () => {
                if (this._source) {
                    this.play(delay, offset);
                }
            };
            if (!!this._config.deferLoad) {
                if (!this._loader) {
                    this._load(null, true);
                }
                this._loader.start(true);
            }
            return this;
        }
        this._playWhenReady = null;
        this._effects.setSource(this._source.sourceNode);

        // update volume needed for no webaudio
        if (this._context.isFake) {
            this.volume = this._gain.gain.value;
        }

        this._source.play(delay, offset);

        if (this._source.hasOwnProperty('loop')) {
            this._source.loop = this._loop;
        }

        this.emit('play', this);

        return this;
    }

    pause() {
        this._source && this._source.pause();
        this.emit('pause', this);
        return this;
    }

    stop(delay) {
        this._source && this._source.stop(delay || 0);
        this.emit('stop', this);
        return this;
    }

    seek(percent) {
        if (this._source) {
            this._source.stop();
            this.play(0, this._source.duration * percent);
        }
        return this;
    }

    fade(volume, duration = 1) {
        if (!this._source) {
            return this;
        }

        const param = this._gain.gain;

        if (this._context && !this._context.isFake) {
            const time = this._context.currentTime;
            param.cancelScheduledValues(time);
            param.setValueAtTime(param.value, time);
            param.linearRampToValueAtTime(volume, time + duration);
        } else if (typeof this._source.fade === 'function') {
            this._source.fade(volume, duration);
            param.value = volume;
        }

        this.emit('fade', this, volume);

        return this;
    }

    unload() {
        this._source && this._source.destroy();
        this._loader && this._loader.destroy();
        this._data = null;
        this._playWhenReady = null;
        this._source = null;
        this._loader = null;
        this._config.deferLoad = true;
        this.emit('unload', this);
    }

    reload() {
        return this.load(null, true);
    }

    destroy() {
        this._source && this._source.destroy();
        this._effects && this._effects.destroy();
        this._gain && this._gain.disconnect();
        if (this._loader) {
            this._loader.off('loaded');
            this._loader.off('error');
            this._loader.destroy();
        }
        this._gain = null;
        this._context = null;
        this._destination = null;
        this._data = null;
        this._playWhenReady = null;
        this._source = null;
        this._effects = null;
        this._loader = null;
        this._config = null;
        this.emit('destroy', this);
        this.off();
    }

    // has(node) {
    //     return this._effects.has(node);
    // }
    //
    // add(node) {
    //     return this._effects.add(node);
    // }
    //
    // remove(node) {
    //     return this._effects.remove(node);
    // }
    //
    // toggle(node, force) {
    //     this._effects.toggle(node, force);
    //     return this;
    // }
    //
    // removeAll() {
    //     this._effects.removeAll();
    //     return this;
    // }

    waveform(length) {
        if (!this._wave) {
            this._wave = utils.waveform();
        }
        if (!this._data) {
            this.once('ready', () => this._wave(this._data, length));
        }
        return this._wave(this._data, length);
    }

    get currentTime() {
        return this._source ? this._source.currentTime : 0;
    }

    get context() {
        return this._context;
    }

    set currentTime(value) {
        this._source && this._source.stop();
        this.play(0, value);
    }

    get data() {
        return this._data;
    }

    set data(value) {
        if (!value) {
            return;
        }
        this._data = value;
        this._createSource(value);
    }

    get duration() {
        return this._source ? this._source.duration : 0;
    }

    get effects() {
        return this._effects._nodes;
    }

    set effects(value) {
        this._effects.removeAll().add(value);
    }

    get fx() {
        return this.effects;
    }

    set fx(value) {
        this.effects = value;
    }

    get ended() {
        return !!this._source && this._source.ended;
    }

    get frequency() {
        return this._source ? this._source.frequency : 0;
    }

    set frequency(value) {
        if (this._source && this._source.hasOwnProperty('frequency')) {
            this._source.frequency = value;
        }
    }

    get gain() {
        return this._gain;
    }

    // for media element source
    get groupVolume() {
        return this._source.groupVolume;
    }

    set groupVolume(value) {
        if (this._source && this._source.hasOwnProperty('groupVolume')) {
            this._source.groupVolume = value;
        }
    }

    set isTouchLocked(value) {
        this._isTouchLocked = value;
        if (this._loader) {
            this._loader.isTouchLocked = value;
        }
        if (!value && this._playWhenReady) {
            this._playWhenReady();
        }
    }

    get loader() {
        return this._loader;
    }

    get loop() {
        return this._loop;
    }

    set loop(value) {
        this._loop = !!value;

        if (this._source && this._source.hasOwnProperty('loop') && this._source.loop !== this._loop) {
            this._source.loop = this._loop;
        }
    }

    get multiPlay() {
        return this._config.multiPlay;
    }

    set multiPlay(value) {
        this._config.multiPlay = value;
        this._source.multiPlay = value;
    }

    get config() {
        return this._config;
    }

    get paused() {
        return !!this._source && this._source.paused;
    }

    get playing() {
        return !!this._source && this._source.playing;
    }

    get playbackRate() {
        return this._playbackRate;
    }

    set playbackRate(value) {
        this._playbackRate = value;
        if (this._source) {
            this._source.playbackRate = value;
        }
    }

    get progress() {
        return this._source ? this._source.progress || 0 : 0;
    }

    get sourceInfo() {
        return this._source && this._source.info ? this._source.info : {};
    }

    get sourceNode() {
        return this._source ? this._source.sourceNode : null;
    }

    get volume() {
        return this._gain.gain.value;
    }

    set volume(value) {
        if (!isSafeNumber(value)) {
            return;
        }

        value = Math.min(Math.max(value, 0), 1);

        const param = this._gain.gain;

        if (this._context && !this._context.isFake) {
            const time = this._context.currentTime;
            param.cancelScheduledValues(time);
            param.value = value;
            param.setValueAtTime(value, time);
        } else {
            param.value = value;

            if (this._source && this._source.hasOwnProperty('volume')) {
                this._source.volume = value;
            }
        }
    }

    get userData() {
        return {};
    }

    _createSource(data) {
        const isAudioBuffer = file.isAudioBuffer(data);
        if (isAudioBuffer || file.isMediaElement(data)) {
            const Fn = isAudioBuffer ? BufferSource : MediaSource;
            this._source = new AudioSource(Fn, data, this._context, this._onEnded);
            this._source.multiPlay = !!this._config.multiPlay;
        } else if (file.isMediaStream(data)) {
            this._source = new MicrophoneSource(data, this._context);
        } else if (file.isOscillatorType((data && data.type) || data)) {
            this._source = new OscillatorSource(data.type || data, this._context);
        } else {
            throw new Error('Cannot detect data type: ' + data);
        }

        this._effects.setSource(this._source.sourceNode);

        this.emit('ready', this);

        if (this._playWhenReady) {
            this._playWhenReady();
        }
    }

    _onEnded() {
        this.emit('ended', this);
    }

    _onLoad(data) {
        this._data = data;
        this.emit('loaded', this);
        this._createSource(data);
    }

    _onLoadError(err) {
        this.emit('error', this, err);
    }
}

// expose for unit tests
Sound.__source = {
    BufferSource,
    MediaSource,
    MicrophoneSource,
    OscillatorSource
};
