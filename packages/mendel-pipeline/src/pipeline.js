const _debug = require('debug');
const MendelRegistry = require('./registry/pipeline');
const Initialize = require('./step/initialize');
const Reader = require('./step/fs-reader');
const IST = require('./step/ist');
const End = require('./step/end');
const GST = require('./step/gst');
const Waiter = require('./step/waiter');

const EventEmitter = require('events').EventEmitter;

module.exports = class MendelPipeline extends EventEmitter {
    constructor ({options, cache, transformer, depsResolver}) {
        super();
        this.debug = _debug('mendel:pipeline:' + options.environment);
        this.cache = cache;

        const registry = this._registry = new MendelRegistry(options, cache);
        const toolset = {
            cache, registry,
            transformer, depsResolver,
        };

        // Pipeline steps
        const initializer = new Initialize(toolset, options);
        const waiter = new Waiter(toolset, options);
        const reader = new Reader(toolset, options);
        const ist = new IST(toolset, options);
        const end = new End(toolset, options);
        const gst = new GST(toolset, options);
        const steps = [initializer, reader, ist, waiter, gst, end];

        steps.forEach((curStep, i) => {
            const nextStep = i < steps.length - 1 ? steps[i + 1] : null;
            curStep.on('done', function({entryId}) {
                const entry = registry.getEntry(entryId);
                if (!nextStep) return;
                try {
                    nextStep.perform.apply(
                        nextStep,
                        [entry].concat(Array.prototype.slice.call(arguments, 1))
                    );
                } catch (e) {
                    console.error(`Mendel "${curStep.constructor.name}" errored: `, e.stack); // eslint-disable-line max-len
                    process.exit(1);
                }
            });

            curStep.on('error', (e) => {
                console.error(`Mendel "${curStep.constructor.name}" errored: `, e.stack); // eslint-disable-line max-len
                process.exit(1);
            });
        });

        this.steps = steps;
    }

    watch() {
        this.debug('working');

        let startedEntries = 0;
        let doneEntries = 0;

        this.steps[0]
            .on('done', () => startedEntries++);

        this.steps[this.steps.length-1]
            .on('done', () => {
                if (++doneEntries === startedEntries) {
                    const total = this.cache.size();
                    this.debug(`${doneEntries} entries were processed.`);
                    this.debug(`${total} entries in registry.`);

                    startedEntries = 0;
                    doneEntries = 0;

                    this.emit('idle', doneEntries);
                }
            });

        this.steps[0].start();
    }
};
