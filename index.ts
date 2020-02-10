import { fromEvents, Stream, Pool, pool, later, sequentially, interval, fromPromise, fromCallback, fromPoll, repeat, stream } from "kefir";

function run(id: string, component: (el: HTMLCanvasElement) => void) {
    const el = window.document.getElementById(id);
    if (!el) {
        throw new Error(`unable to locate element by id ${id}`);
    }
    if (el instanceof HTMLCanvasElement) {
        component(el);
    } else {
        throw new Error(`element by id is not a canvas ${id}`);
    }
}

type Draw = (canvas: HTMLCanvasElement) => void;

type Point = readonly [number, number];

run('main', (el) => {
    const draws = component(el, follow);
    const throttle = repeat(() => fromPromise(new Promise((resolve) => requestAnimationFrame(() => resolve()))));
    
    const animated = draws.flatMap(animate)
        .debounce(15)
        .observe(draw => {
            console.log("drawing at " + Date.now());
            draw(el);
        });
});

function animate(draw: Draw): Stream<Draw, void> {
    return stream(emitter => {
        const req = requestAnimationFrame(() => {
            emitter.emit(draw);
            emitter.end();
        })
        return () => {
            cancelAnimationFrame(req);
        }
      });
    // return fromCallback((cb) => {
    //     requestAnimationFrame(() => {
    //         cb(draw)
    //     })
    // });
}

function component<S, El>(el: El, comp: (el: El, s: Stream<S, void>) => { out: Stream<S, void>, render: Stream<Draw, void> }): Stream<Draw, void> {
    const connect: Pool<S, void> = pool();
    const run = comp(el, connect);
    connect.plug(run.out);
    return run.render;
}

function follow(el: HTMLCanvasElement, s: Stream<Point, void>): { out: Stream<Point, void>, render: Stream<Draw, void> } {
    const state = later(0, [0, 0] as Point).concat(s);

    const position = fromEvents(el, "mousemove")
        .throttle(100)
        .map((ev: MouseEvent) => [ev.offsetX, ev.offsetY] as Point)

    // Everytime position fires, we want to grab the latest state and construct an animation
    const at = state.sampledBy(position, (start, to) => {
        const deltaX = to[0] - start[0];
        const deltaY = to[1] - start[1]
        return linearDuration(5, 500)
            .map((rel) => [start[0] + deltaX * rel, start[1] + deltaY * rel] as Point);
    })
    .flatMapLatest(x => x)

    const draw = at.map(
        (point: Point) =>
            (el: HTMLCanvasElement) => {
                const ctx = el.getContext('2d');
                ctx.fillStyle='white';
                ctx.fillRect(0, 0, el.width, el.height);
                // ctx.clearRect(0, 0, el.width, el.height);
                ctx.beginPath();
                ctx.strokeStyle = 'black';
                ctx.arc(point[0], point[1], 20, 0, 355);
                ctx.stroke();
            }
    );

    return {
        out: at,
        render: draw
    }
}

function linearDuration(resolutionMS: number, durationMS: number): Stream<number, void> {
    return interval(resolutionMS, resolutionMS)
        .scan<number>((l, r) => l + r)
        .take(durationMS / resolutionMS)
        .map((current) => current / durationMS);
}