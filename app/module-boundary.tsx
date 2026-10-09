"use client";

import { Component, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';

export function ModuleLoading() {
  return <div className="loading-state" role="status"><BookOpen size={28}/><p>正在打开学习空间…</p><div className="skeleton-line"/><div className="skeleton-line short"/></div>;
}

export class ModuleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="loading-state" role="alert"><h2>页面资源未能加载</h2><p>请检查连接后重新打开。已保存的学习记录不会丢失。</p><button className="secondary" onClick={() => window.location.reload()}>重新加载页面</button></div>;
    return this.props.children;
  }
}
