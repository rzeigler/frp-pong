import * as i from "./impl";
import { Observable, interval, animationFrameScheduler, never, NEVER, Subject, combineLatest, of, merge } from "rxjs";
import { map, share, withLatestFrom, filter, flatMap, scan, tap, sample } from "rxjs/operators";
import * as A from "fp-ts/lib/Array";
import { pipe } from "fp-ts/lib/pipeable";
import { Lens } from "monocle-ts";
import { identity } from "fp-ts/lib/function";

export interface PongSources {
    dom: i.DOM;
    state: Observable<PongState>;
}

export interface PongSinks {
    draws: Observable<i.Draw>;
    state: Observable<i.Reducer<PongState>>;
}

export interface Point2d {
    readonly x: number;
    readonly y: number;
}

const BALL_RADIUS = 10
const PADDLE_WIDTH = 10
const LEFT_PADDLE = 20
const PADDLE_HEIGHT = 50

export interface PongState {
    ball: Point2d;
    velocity: Point2d;
    leftPaddle: number;
    rightPaddle: number;
}

const lpLens = Lens.fromProp<PongState>()("leftPaddle");
const rpLens = Lens.fromProp<PongState>()("rightPaddle");

const add = (x: number) => (y: number) => x + y;

function nextVelocity(size: i.Size2d, state: PongState): Point2d {
    // If the ball is in contact with the top wall and moving up, invert
    // This hit detection is... not good... it ignores things like the bottom of the paddle for instance
    // It also will only do 1 hit per tick...
    if (state.ball.y - BALL_RADIUS <= 0 && state.velocity.y < 0) {
        return { ...state.velocity, y: state.velocity.y * -1 };
    }
    if (state.ball.y + BALL_RADIUS >= size.height && state.velocity.y > 0) {
        return { ...state.velocity, y: state.velocity.y * -1 };
    }
    if (state.ball.x - BALL_RADIUS <= 0 && state.velocity.x < 0) {
        return { ...state.velocity, x: state.velocity.x * -1 };
    }
    if (state.ball.x + BALL_RADIUS >= size.width && state.velocity.x > 0) {
        return { ...state.velocity, x: state.velocity.x * -1 };
    }
    if (state.ball.x - BALL_RADIUS <= LEFT_PADDLE &&
        state.ball.y <= state.leftPaddle + PADDLE_HEIGHT &&
        state.ball.y >= state.leftPaddle) {
        return { ...state.velocity, y: state.velocity.y * -1 };
    }
    if (state.ball.x + BALL_RADIUS >= size.width - LEFT_PADDLE &&
        state.ball.y <= state.rightPaddle + PADDLE_HEIGHT &&
        state.ball.y >= state.rightPaddle) {
        return { ...state.velocity, y: state.velocity.y * -1 };
    }
    return state.velocity;
}

const tickBall = (size: i.Size2d) => (state: PongState): PongState => {
    const velocity = nextVelocity(size, state);
    const ball = { x: state.ball.x + velocity.x, y: state.ball.y + velocity.y }
    return { ...state, velocity, ball }
}

function drawState(size: i.Size2d, state: PongState): i.Draw {
    return i.all([
        i.clearRect(0, 0, size.width, size.height),
        i.beginPath(),
        i.strokeStyle('black'),
        i.fillStyle('black'),
        i.arc(state.ball.x, state.ball.y, BALL_RADIUS, 0, 360),
        i.stroke,
        i.fillRect(LEFT_PADDLE - PADDLE_WIDTH, state.leftPaddle, PADDLE_WIDTH, PADDLE_HEIGHT),
        i.fillRect(size.width - LEFT_PADDLE, state.rightPaddle, PADDLE_WIDTH, PADDLE_HEIGHT)
    ])
}

function computePaddleMotion(keys: string[]): i.Reducer<PongState> {
    const reducers = keys.map((k) => {
        switch (k) {
            case "w":
                return lpLens.modify(add(-10));
            case "s":
                return lpLens.modify(add(10));
            case "ArrowUp":
                return rpLens.modify(add(-10));
            case "ArrowDown":
                return rpLens.modify(add(10));
            default:
                return identity
        }
    });
    return reducers.length > 0 ? reducers.reduce((f, g) => (x) => f(g(x))) : identity;
}

const keyUp = (e: KeyboardEvent) => (as: string[]) =>
    pipe(as, A.filter((k) => k !== e.key))

const keyDown = (e: KeyboardEvent) => (as: string[]) =>
    A.snoc(keyUp(e)(as), e.key)

function Test(sources: PongSources): PongSinks {
    const tickRate = interval(17).pipe(share());
    // We want the current canvas size
    // We cannot just sample here because distincts are eliminated
    const canvasSize = sources.dom
        .dimensions("#main", tickRate)
        .pipe(share())

    const ballMotion =
        tickRate
            // sample doesn't do what we want as it surpresses duplicates
            .pipe(withLatestFrom(canvasSize))
            .pipe(map(([_, size]) => tickBall(size)))

    const draws =
        combineLatest([canvasSize, sources.state], drawState)

    const keyDowns =
        sources.dom
            .keydown("#main")
            .pipe(map(keyDown))

    const keyUps =
        sources.dom
            .keyup("#main")
            .pipe(map(keyUp))

    const paddleMotion =
        merge(keyDowns, keyUps)
            .pipe(scan((as, f) => f(as), []))
            .pipe(map(computePaddleMotion))
            .pipe(sample(tickRate))

    return { draws, state: merge(ballMotion, paddleMotion) };
}



const drivers = {
    dom: i.makeDOMDriver(),
    draws: i.makeCanvasDriver(document.querySelector("#main"))
}

const initial: PongState = {
    ball: {
        x: 20,
        y: 20
    },
    velocity: {
        x: 3,
        y: 3
    },
    leftPaddle: 10,
    rightPaddle: 400
};

const sub = i.run(drivers)(i.stateful(initial, Test));

