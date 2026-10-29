import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from './state/AppContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* No v7_startTransition: pages update state and then navigate (sign-in, registration), and their
        own guards would redirect first if navigation were deferred. */}
    <HashRouter future={{ v7_relativeSplatPath: true }}>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </React.StrictMode>,
);
