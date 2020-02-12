import { Observable, Subscription, from, merge, NEVER, Subject, animationFrameScheduler, interval, fromEvent, of } from "rxjs";
import { mergeAll, observeOn, throttleTime, map, mapTo, publish, scan, distinct, distinctUntilChanged, tap, concat } from "rxjs/operators";

export enum DriverType {
    SinkOnly,
    SourceOnly,
    Full
}

export interface SinkDriver<O> {
    _tag: DriverType.SinkOnly;
    readonly receive: (out: Observable<O>) => Observable<void>;
}

export function sinkDriver<O>(receive: (out: Observable<O>) => Observable<void>): SinkDriver<O> {
    return {
        _tag: DriverType.SinkOnly,
        receive
    }
}

export interface SourceDriver<I> {
    _tag: DriverType.SourceOnly;
    readonly provide: I
}

export function sourceDriver<I>(provide: I): SourceDriver<I> {
    return {
        _tag: DriverType.SourceOnly,
        provide
    }
}

export interface FullDriver<I, O> {
    _tag: DriverType.Full;
    readonly receive: (out: Observable<O>) => Observable<void>;
    readonly provide: I
}

export function fullDriver<I, O>(provide: I, receive: (out: Observable<O>) => Observable<void>): FullDriver<I, O> {
    return {
        _tag: DriverType.Full,
        receive,
        provide
    };
}

/**
 * The various types of a driver
 */
export type Driver<I, O> = SourceDriver<I> | SinkDriver<O> | FullDriver<I, O>;

export type Component<I, O> = (source: I) => O

/**
 * We can select a type for a driver which is either some type or never if the driver doesn't provide that direction
 */
export type InT<D> = D extends SourceDriver<infer I> ? I : (D extends FullDriver<infer I, any> ? I : never);
export type OutT<D> = D extends SinkDriver<infer O> ? Observable<O> : (D extends FullDriver<any, infer O> ? Observable<O> : never)

/**
 * For every key in the Driver set, compute the corresponding type of using that driver
 */
export type CInT<D> = { [K in keyof D]: InT<D[K]> }
export type COutT<D> = { [K in keyof D]: OutT<D[K]> }

/**
 * Construct a type for the field names where the property type is never
 * This allows us to omit them
 */
export type NeverFields<D> = { [K in keyof D]: D[K] extends never ? K : never }[keyof D]

/**
 * Construct the input type of a component given a driver type
 * We omit all never fields from the CInT computed type to ensure we ahve only elements where 
 * there is a valid source to attach
 */
export type ComponentSource<D> = Omit<CInT<D>, NeverFields<CInT<D>>>;
/**
 * See above but for the sink types
 */
export type ComponentSink<D> = Omit<COutT<D>, NeverFields<COutT<D>>>;

/**
 * Now, we attempt to see if a Component is a suitable receiver for a driver.
 * This requires that the driver have more source producers than the component requires
 * and similarly, the driver has equivalent sinks for the components outputs
 * We handle a missing sink from the component by coallescing to NEVER as a shortcut
 */
export type InferComponent<D, C> = C extends Component<infer I, infer O> ?
    (ComponentSource<D> extends I ? (ComponentSink<D> extends O ? C : never) : never) : never

export function run<D>(drivers: D) {
    return <C>(component: InferComponent<D, C>): Subscription => {
        // We trust on the typesafety produce by our type functions mostly, in here there are dragons
        const sources = {};
        Object.keys(drivers).forEach((key) => {
            const drv = drivers[key] as Driver<unknown, unknown>;
            if (drv._tag === DriverType.SourceOnly || drv._tag === DriverType.Full) {
                sources[key] = drv.provide;
            }
        })
        const sinks = component(sources as any);
        const sunk: Array<Observable<void>> = [];
        Object.keys(drivers).forEach((key) => {
            const drv = drivers[key] as Driver<unknown, unknown>;
            if (drv._tag === DriverType.SinkOnly || drv._tag === DriverType.Full) {
                sunk.push(drv.receive(sinks[key] || NEVER)); // The component didn't produce, so...
            }
        })
        return from(sunk)
            .pipe(mergeAll())
            .subscribe();
    }
}

export type Reducer<S> = (s: S) => S;

/**
 * Create a stateful component
 * @param key 
 * @param initial 
 * @param component 
 */
export function stateful<S, I extends { state: Observable<S> }, O extends { state: Observable<Reducer<S>> }>(initial: S, component: Component<I, O>): Component<Omit<I, 'state'>, Omit<O, 'state'>> {
    return (inputs: Omit<I, 'state'>): Omit<O, 'state'> => {
        const loopback = new Subject<S>();
        /**
         * This is not exactly sound. I'm not sure how to enforce that K is a true singleton type so there end up being casts required
         */
        const sinks = component({ ...inputs, state: loopback as Observable<S> } as unknown as I);
        const reduced = of<Reducer<S>>((s) => s)
            .pipe(concat(sinks.state))
            .pipe(scan((s, f) => f(s), initial));
        // How do we break this cycle
        reduced.subscribe(loopback);
        // Delete it so it doesn't appear downstream either
        delete sinks.state;
        return sinks;
    }
}


// Here beings the drawing
export enum DrawType {
    And,
    FillRect,
    FillStyle,
    BeginPath,
    ClearRect,
    Arc,
    Stroke,
    Fill,
    StrokeStyle
}

export type Draw = And | DrawOp;
export type DrawOp = FillRect | FillStyle | BeginPath | ClearRect | Arc | Stroke | Fill | StrokeStyle;

export class And {
    public readonly _tag: DrawType.And = DrawType.And;
    constructor(public readonly first: Draw, public readonly second: Draw) { }
    *gen(): Generator<DrawOp> {
        yield* this.first.gen();
        yield* this.second.gen();
    }
}

export function and(first: Draw, second: Draw): Draw {
    return new And(first, second);
}

export function all(draws: Draw[]): Draw {
    return draws.reduce(and);
}

export class FillRect {
    public readonly _tag: DrawType.FillRect;
    constructor(public readonly x: number, public readonly y: number, public readonly width: number, public readonly height: number) {
        this._tag = DrawType.FillRect;
    }

    *gen(): Generator<DrawOp> {
        yield this;
    }
}

export function fillRect(x: number, y: number, width: number, height: number): Draw {
    return new FillRect(x, y, width, height);
}

export class FillStyle {
    public readonly _tag: DrawType.FillStyle = DrawType.FillStyle;
    constructor(public readonly style: string | CanvasGradient | CanvasPattern) { }
    *gen(): Generator<DrawOp> {
        yield this;
    }
}

export function fillStyle(style: string | CanvasGradient | CanvasPattern): Draw {
    return new FillStyle(style);
}

export class StrokeStyle {
    public readonly _tag: DrawType.StrokeStyle = DrawType.StrokeStyle
    constructor(public readonly style: string | CanvasGradient | CanvasPattern) { }
    *gen(): Generator<DrawOp> {
        yield this;
    }
}

export function strokeStyle(style: string | CanvasGradient | CanvasPattern): Draw {
    return new StrokeStyle(style);
}

export class BeginPath {
    public readonly _tag: DrawType.BeginPath;
    constructor() {
        this._tag = DrawType.BeginPath;
    }
    *gen(): Generator<DrawOp> {
        yield this;
    }
}

const _begin = new BeginPath();

export function beginPath(): Draw {
    return _begin;
}

export class ClearRect {
    public readonly _tag: DrawType.ClearRect;
    constructor(public readonly x: number, public readonly y: number, public readonly width: number, public readonly height: number) {
        this._tag = DrawType.ClearRect;
    }

    *gen(): Generator<DrawOp> {
        yield this;
    }
}

export function clearRect(x: number, y: number, width: number, height: number): Draw {
    return new ClearRect(x, y, width, height);
}

export class Arc {
    readonly _tag: DrawType.Arc = DrawType.Arc;
    constructor(public readonly x: number, public readonly y: number, public readonly r: number, public readonly sAngle: number, public readonly eAngle: number, public readonly anticlockwise?: boolean) { }
    *gen(): Generator<DrawOp> {
        yield this;
    }
}

export function arc(x: number, y: number, r: number, sAngle: number, eAngle: number, anticlockwise?: boolean): Draw {
    return new Arc(x, y, r, sAngle, eAngle, anticlockwise);
}

export class Stroke {
    readonly _tag: DrawType.Stroke = DrawType.Stroke;
    constructor() { }
    *gen(): Generator<DrawOp> {
        yield this;
    }
}

export const stroke = new Stroke();

export class Fill {
    readonly _tag: DrawType.Fill = DrawType.Fill;
    constructor() { }
    *gen(): Generator<DrawOp> {
        yield this;
    }
}

export const fill = new Fill();

export function draw(canvas: HTMLCanvasElement, draw: Draw): void {
    const ctx = canvas.getContext("2d");
    const g = draw.gen();
    let cur = g.next();
    while (!cur.done) {
        drawImpl(ctx, cur.value);
        cur = g.next();
    }
}

function drawImpl(ctx: CanvasRenderingContext2D, draw: DrawOp): void {
    switch (draw._tag) {
        case DrawType.BeginPath:
            ctx.beginPath();
            return;
        case DrawType.ClearRect:
            ctx.clearRect(draw.x, draw.y, draw.width, draw.height);
            return;
        case DrawType.FillRect:
            ctx.fillRect(draw.x, draw.y, draw.width, draw.height);
            return;
        case DrawType.FillStyle:
            ctx.fillStyle = draw.style;
            return;
        case DrawType.Arc:
            ctx.arc(draw.x, draw.y, draw.r, draw.sAngle, draw.eAngle, draw.anticlockwise);
            return;
        case DrawType.Fill:
            ctx.fill();
            return;
        case DrawType.Stroke:
            ctx.stroke();
            return;
    }
}


export function makeCanvasDriver(el: HTMLCanvasElement): SinkDriver<Draw> {
    return sinkDriver((draws: Observable<Draw>) =>
        draws.pipe(observeOn(animationFrameScheduler))
            .pipe(throttleTime(1)) // Ensure we only emit the very first
            .pipe(map((d) => draw(el, d))))
}

export interface Size2d {
    readonly width: number;
    readonly height: number;
}

export interface DOM {
    mousemove(selector: string): Observable<MouseEvent>
    keydown(selector: string): Observable<KeyboardEvent>
    keyup(selector: string): Observable<KeyboardEvent>
    keypress(selector: string): Observable<KeyboardEvent>
    dimensions(selector: string, sampleInterval: Observable<unknown>): Observable<Size2d>
}

export function makeDOMDriver(): SourceDriver<DOM> {
    function attach<E = Event>(selector: string, event: string): Observable<E> {
        const node = document.querySelector(selector);
        if (node) {
            return fromEvent<E>(node, event);
        }
        return NEVER;
    }

    return sourceDriver({
        // Note... none of these handle elements appearing or disappearing
        mousemove(selector: string): Observable<MouseEvent> {
            return attach<MouseEvent>(selector, 'mousemove');
        },
        keydown(selector: string): Observable<KeyboardEvent> {
            return attach<KeyboardEvent>(selector, 'keydown');
        },
        keyup(selector: string): Observable<KeyboardEvent> {
            return attach<KeyboardEvent>(selector, 'keyup');
        },
        keypress(selector: string): Observable<KeyboardEvent> {
            return attach<KeyboardEvent>(selector, 'keypress');
        },
        dimensions(selector: string, sampleInterval: Observable<unknown>): Observable<Size2d> {
            const node = document.querySelector(selector);
            if (node) {
                return sampleInterval
                    .pipe(map(() => ({ width: node.clientWidth, height: node.clientHeight } as Size2d)))
                    .pipe(distinctUntilChanged((x, y) => x.width === y.width && x.height === y.height))
            }
            console.warn("invalid dimensions selector");
            return NEVER;
        }
    })
}