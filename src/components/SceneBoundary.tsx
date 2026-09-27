import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props {
    children: ReactNode;
    /** Told when the scene is left out (the page's loader stops waiting for it). */
    onError?: () => void;
}

interface State {
    failed: boolean;
}

/**
 * The WebGL scene is the page's most fragile part: its chunk can fail to
 * download, the GPU can refuse a context, a driver can reject a shader. None
 * of that should take the page with it. Whatever throws in here is caught and
 * the scene is simply left out: the painted water, the marine snow, the story
 * and the work carry on as a DOM page, and the story's words fall back to the
 * page's own clock (see Story.tsx: no whale, no swim-by).
 */
export default class SceneBoundary extends Component<Props, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.warn('[scene] the WebGL scene failed and was left out; the page carries on without it.', error);
        this.props.onError?.();
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}
