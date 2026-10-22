import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './Motion.css';
class Boundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() { return this.state.failed ? <main className="app-boot"><h1>页面暂时未能打开</h1><p>已经保存的学习记录仍在本机。请重新打开应用。</p><button onClick={() => location.reload()}>重新打开</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Boundary><App/></Boundary></React.StrictMode>);
