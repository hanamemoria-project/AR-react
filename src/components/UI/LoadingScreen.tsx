import { useAppStore } from '../../store/useAppStore';

export default function LoadingScreen() {
  const { loadingProgress, loadingStep, hasStarted } = useAppStore();

  const getStepStatus = (step: 'init' | 'ai' | 'ar' | 'done') => {
    if (loadingStep === step) return 'active';
    const order: Record<'init' | 'ai' | 'ar' | 'done', number> = { 'init': 0, 'ai': 1, 'ar': 2, 'done': 3 };
    return order[loadingStep] > order[step] ? 'done' : 'pending';
  };

  const renderIcon = (status: 'active' | 'done' | 'pending') => {
    if (status === 'done') {
      return (
        <svg className="step-icon done-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      );
    }
    if (status === 'active') {
      return (
        <svg className="step-icon active-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
        </svg>
      );
    }
    return <span className="step-icon pending-icon">○</span>;
  };

  if (hasStarted) return null;

  return (
    <div id="loading" style={{ opacity: loadingProgress >= 100 ? 0 : 1, transition: 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }}>
      <div id="loading-inner" className="glass-panel">
        <div id="loading-mascot-container">
          <img src="https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/Animasi/1000283700-removebg-preview.png" id="loading-mascot" alt="Hana Mascot" />
          <div className="loading-mascot-speech glass-speech">
            Hana sedang merakit<br />kenanganmu... ✨
          </div>
        </div>
        <div id="loading-title">HANA MEMORIA</div>
        <div id="loading-tagline">Mengabadikan cerita dalam setiap bingkai.</div>
        
        <div id="loading-progress-container">
          <div id="loading-progress-bar">
            <div id="loading-progress-fill" style={{ width: `${loadingProgress}%` }}></div>
          </div>
          <div id="loading-percentage">{Math.round(loadingProgress)}%</div>
        </div>
        
        <div id="loading-steps">
          <div className={`loading-step ${getStepStatus('init')}`} id="step-init">
            {renderIcon(getStepStatus('init'))}
            <span className="step-text">Menghubungkan ke server</span>
          </div>
          <div className={`loading-step ${getStepStatus('ai')}`} id="step-ai">
            {renderIcon(getStepStatus('ai'))}
            <span className="step-text">Memuat AI gestur</span>
          </div>
          <div className={`loading-step ${getStepStatus('ar')}`} id="step-ar">
            {renderIcon(getStepStatus('ar'))}
            <span className="step-text">Memuat pemindai AR</span>
          </div>
        </div>
      </div>
    </div>
  );
}
