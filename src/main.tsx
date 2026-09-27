import './styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';

import Layout from './components/Layout';

// One page, rendered directly. It used to go through React Router with a
// single "/" route: ~60 kB of router for no navigation, and a route that
// matched only at the domain root, so the site 404'd if it was ever served
// from a sub-path (a GitHub Pages project URL, a preview deploy).
//
// Layout renders the scene itself (see WebGLStage). Listing it again as a
// child route once put two whales, two light rigs and two EffectComposers
// into the one shared canvas.
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Layout />
    </React.StrictMode>,
);
