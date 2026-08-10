import {
  ArrowDown,
  ArrowRight,
  Cloud,
  Image as ImageIcon,
  Layers3,
  LayoutDashboard,
  LogIn,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { FALLBACK_SITE_CONFIG, fetchPublicSiteConfig } from "@/api/siteConfig";
import { getPublicPageHref } from "@/features/public/publicPages";

interface PublicHomeProps {
  onLogin: () => void;
  onRegister: () => void;
  authenticated?: boolean;
  onEnterCanvas?: () => void;
}

function Brand({
  config,
  logoUrl,
  href,
}: {
  config: SiteConfigDocument;
  logoUrl: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="home-brand"
      aria-label={`${config.shortName} 首页`}
    >
      <img
        src={logoUrl}
        alt=""
        className="home-brand__mark"
        width="36"
        height="36"
      />
      <span className="home-brand__name">{config.shortName}</span>
    </a>
  );
}

function CanvasScene({ logoUrl }: { logoUrl: string }) {
  return (
    <div className="home-canvas-scene" aria-hidden="true">
      <div className="home-canvas-scene__grid" />
      <div className="home-scene-connection home-scene-connection--a">
        <span />
      </div>
      <div className="home-scene-connection home-scene-connection--b">
        <span />
      </div>

      <div className="home-scene-node home-scene-node--source">
        <div className="home-scene-node__bar">
          <ImageIcon />
          <span>参考图</span>
        </div>
        <div className="home-scene-source-image">
          <img src={logoUrl} alt="" />
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
            <img src={logoUrl} alt="" />
          </div>
        </div>
        <span className="home-scene-handle home-scene-handle--left" />
      </div>
    </div>
  );
}

export function PublicHome({
  onLogin,
  onRegister,
  authenticated = false,
  onEnterCanvas = onLogin,
}: PublicHomeProps) {
  const [site, setSite] =
    useState<PublicSiteConfigResponse>(FALLBACK_SITE_CONFIG);
  useEffect(() => {
    let active = true;
    let refreshTimer: number | undefined;
    const refresh = async () => {
      const value = await fetchPublicSiteConfig();
      if (!active) return;
      setSite(value);
      if (value.assets.favicon?.url) {
        const icon =
          document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
          document.createElement("link");
        icon.rel = "icon";
        icon.href = value.assets.favicon.url;
        icon.type = value.assets.favicon.mimeType;
        if (!icon.parentNode) document.head.appendChild(icon);
      }
      document.title = value.config.siteName;
      document.documentElement.dataset.siteThemePreset =
        value.config.themePreset;
      const expiries = [
        value.assets.logo?.expiresAt,
        value.assets.favicon?.expiresAt,
      ]
        .filter((item): item is string => Boolean(item))
        .map((item) => new Date(item).getTime());
      const delay =
        expiries.length > 0
          ? Math.max(60_000, Math.min(...expiries) - Date.now() - 30_000)
          : 5 * 60_000;
      refreshTimer = window.setTimeout(() => void refresh(), delay);
    };
    void refresh();
    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, []);
  const config = site.config;
  const logoUrl = site.assets.logo?.url ?? "/brand/ai-canvas-mark.png";
  const homeHref = authenticated ? "/home" : "/";
  const handlePrimaryAction = authenticated ? onEnterCanvas : onLogin;
  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="home-header__inner">
          <Brand config={config} logoUrl={logoUrl} href={homeHref} />
          <nav className="home-header__nav" aria-label="主要导航">
            <a
              className="home-nav-link home-nav-link--active"
              href={homeHref}
              aria-current="page"
            >
              首页
            </a>
            <a className="home-nav-link" href="/community">
              社区中心
            </a>
          </nav>
          <div className="home-header__actions">
            {authenticated ? (
              <button
                type="button"
                className="home-register-button"
                onClick={onEnterCanvas}
              >
                <LayoutDashboard aria-hidden="true" />
                进入画布
                <ArrowRight aria-hidden="true" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="home-login-button"
                  onClick={onLogin}
                >
                  <LogIn aria-hidden="true" />
                  <span>登录</span>
                </button>
                {config.features.registrationEnabled ? (
                  <button
                    type="button"
                    className="home-register-button"
                    onClick={onRegister}
                  >
                    免费注册
                    <ArrowRight aria-hidden="true" />
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </header>

      <section className="home-hero">
        <CanvasScene logoUrl={logoUrl} />
        <div className="home-hero__shade" />
        <div className="home-hero__content">
          <h1>{config.home.headline}</h1>
          <p className="home-hero__lead">{config.home.lead}</p>
          <p className="home-hero__description">{config.home.description}</p>
          <div className="home-hero__actions">
            <button
              type="button"
              className="home-primary-action"
              onClick={handlePrimaryAction}
            >
              <WandSparkles aria-hidden="true" />
              {authenticated ? "进入创作画布" : config.home.primaryActionLabel}
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
        <a
          className="home-scroll-cue"
          href="#home-capabilities"
          aria-label="查看产品能力"
        >
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
              <p>项目与媒体资产安全保存在云端。</p>
            </div>
          </div>
          <div className="home-capability">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h3>私有边界</h3>
              <p>账号、Provider 与作品资产严格隔离。</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-footer__main">
          <div className="home-footer__brand">
            <a href={homeHref} aria-label={`${config.shortName} 首页`}>
              <img src={logoUrl} alt="" width="42" height="42" />
              <span>{config.shortName}</span>
              <small>Cloud</small>
            </a>
            <p>{config.footer.description}</p>
          </div>

          <div className="home-footer__links">
            {config.navigation.includes("home") ? (
              <div>
                <h3>产品</h3>
                <button type="button" onClick={handlePrimaryAction}>
                  {authenticated ? "进入画布" : "开始创作"}
                </button>
              </div>
            ) : null}
            {config.navigation.includes("help") ? (
              <div>
                <h3>支持</h3>
                <a href={getPublicPageHref(config, "help")}>帮助中心</a>
                {config.features.feedbackEnabled ? (
                  <a href={getPublicPageHref(config, "feedback")}>问题反馈</a>
                ) : null}
              </div>
            ) : null}
            {config.navigation.includes("legal") ? (
              <div>
                <h3>法律</h3>
                <a href={getPublicPageHref(config, "terms")}>用户协议</a>
                <a href={getPublicPageHref(config, "privacy")}>隐私政策</a>
                {config.links.accountDeletionUrl ? (
                  <a href={config.links.accountDeletionUrl}>账号注销说明</a>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="home-footer__bottom">
          <span>{config.footer.copyright}</span>
          <div className="home-footer__records">
            {config.records.companyName ? (
              <span>{config.records.companyName}</span>
            ) : null}
            {config.records.icpNumber ? (
              <span>{config.records.icpNumber}</span>
            ) : null}
            {config.records.publicSecurityNumber ? (
              <span>{config.records.publicSecurityNumber}</span>
            ) : null}
          </div>
        </div>
      </footer>
    </main>
  );
}
import { useEffect, useState } from "react";
import type {
  PublicSiteConfigResponse,
  SiteConfigDocument,
} from "@ai-canvas-cloud/contracts/site-config";
