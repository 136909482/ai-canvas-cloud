import {
  ArrowDown,
  ArrowRight,
  Cloud,
  Image as ImageIcon,
  Layers3,
  LogIn,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react'

interface PublicHomeProps {
  onLogin: () => void
  onRegister: () => void
}

function Brand() {
  return (
    <a href="/" className="home-brand" aria-label="AI Canvas 首页">
      <img
        src="/brand/ai-canvas-mark.png"
        alt=""
        className="home-brand__mark"
        width="36"
        height="36"
      />
      <span className="home-brand__name">AI Canvas</span>
      <span className="home-brand__edition">Cloud</span>
    </a>
  )
}

function CanvasScene() {
  return (
    <div className="home-canvas-scene" aria-hidden="true">
      <div className="home-canvas-scene__grid" />
      <div className="home-scene-connection home-scene-connection--a"><span /></div>
      <div className="home-scene-connection home-scene-connection--b"><span /></div>

      <div className="home-scene-node home-scene-node--source">
        <div className="home-scene-node__bar">
          <ImageIcon />
          <span>参考图</span>
        </div>
        <div className="home-scene-source-image">
          <img src="/brand/ai-canvas-mark.png" alt="" />
        </div>
        <span className="home-scene-handle home-scene-handle--right" />
      </div>

      <div className="home-scene-node home-scene-node--prompt">
        <div className="home-scene-node__bar">
          <Layers3 />
          <span>创意描述</span>
        </div>
        <p>极简未来感产品主视觉，柔和自然光，精致材质细节</p>
        <div className="home-scene-tags">
          <span>1:1</span>
          <span>高清</span>
        </div>
        <span className="home-scene-handle home-scene-handle--left" />
        <span className="home-scene-handle home-scene-handle--right" />
      </div>

      <div className="home-scene-node home-scene-node--result">
        <div className="home-scene-node__bar">
          <Sparkles />
          <span>生成结果</span>
        </div>
        <div className="home-scene-result-image">
          <div className="home-scene-result-object">
            <img src="/brand/ai-canvas-mark.png" alt="" />
          </div>
        </div>
        <span className="home-scene-handle home-scene-handle--left" />
      </div>
    </div>
  )
}

export function PublicHome({ onLogin, onRegister }: PublicHomeProps) {
  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="home-header__inner">
          <Brand />
          <div className="home-header__actions">
            <button type="button" className="home-login-button" onClick={onLogin}>
              <LogIn aria-hidden="true" />
              <span>登录</span>
            </button>
            <button type="button" className="home-register-button" onClick={onRegister}>
              免费注册
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <section className="home-hero">
        <CanvasScene />
        <div className="home-hero__shade" />
        <div className="home-hero__content">
          <h1>AI Canvas</h1>
          <p className="home-hero__lead">让创意，在画布上自然生长</p>
          <p className="home-hero__description">
            把灵感、素材与 AI 生成工作流放进同一张画布，随时回来，继续创作。
          </p>
          <div className="home-hero__actions">
            <button type="button" className="home-primary-action" onClick={onRegister}>
              <WandSparkles aria-hidden="true" />
              开始创作
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
        <a className="home-scroll-cue" href="#home-capabilities" aria-label="查看产品能力">
          <ArrowDown aria-hidden="true" />
        </a>
      </section>

      <section id="home-capabilities" className="home-capabilities">
        <div className="home-capabilities__intro">
          <span>从灵感到成品</span>
          <h2>一张画布，接住完整创作过程</h2>
        </div>
        <div className="home-capabilities__items">
          <div className="home-capability">
            <Layers3 aria-hidden="true" />
            <div>
              <h3>自由编排</h3>
              <p>素材、提示词与生成节点保持清晰关联。</p>
            </div>
          </div>
          <div className="home-capability">
            <Cloud aria-hidden="true" />
            <div>
              <h3>云端延续</h3>
              <p>项目与媒体资产进入你的个人空间。</p>
            </div>
          </div>
          <div className="home-capability">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h3>私有边界</h3>
              <p>账号、Provider 与作品资产按工作区隔离。</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-footer__main">
          <div className="home-footer__brand">
            <a href="/" aria-label="AI Canvas 首页">
              <img src="/brand/ai-canvas-mark.png" alt="" width="42" height="42" />
              <span>AI Canvas</span>
              <small>Cloud</small>
            </a>
            <p>面向创作者的云端 AI 画布。</p>
          </div>

          <div className="home-footer__links">
            <div>
              <h3>产品</h3>
              <button type="button" onClick={onRegister}>开始创作</button>
            </div>
            <div>
              <h3>支持</h3>
              <span>帮助中心</span>
              <span>问题反馈</span>
              <span className="home-footer__pending">联系方式待补充</span>
            </div>
            <div>
              <h3>法律</h3>
              <span>用户协议</span>
              <span>隐私政策</span>
              <span>账号注销说明</span>
            </div>
          </div>
        </div>

        <div className="home-footer__bottom">
          <span>© 2026 AI Canvas Cloud</span>
          <div className="home-footer__records">
            <span>企业主体信息待补充</span>
            <span>ICP备案号待补充</span>
            <span>公安备案号待补充</span>
          </div>
        </div>
      </footer>
    </main>
  )
}
