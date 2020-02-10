function run(id: string, component: (el: HTMLCanvasElement) => void) {
    const el = window.document.getElementById(id);
    if (!el) {
        throw new Error(`unable to locate element by id ${id}`);
    }
    if (el instanceof HTMLCanvasElement)  {
        component(el);
    } else {
        throw new Error(`element by id is not a canvas ${id}`);
    }
}

run('main', (el) => {

})