import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ArrowLeft,
  BookOpenText,
  FileCheck2,
  LifeBuoy,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import type { PublicSiteConfigResponse } from "@ai-canvas-cloud/contracts/site-config";
import { FALLBACK_SITE_CONFIG, fetchPublicSiteConfig } from "@/api/siteConfig";
import {
  PUBLIC_PAGE_META,
  PUBLIC_PAGE_ORDER,
  getPublicPageHref,
  type PublicPageKind,
} from "./publicPages";

interface PublicContentPageProps {
  kind: PublicPageKind;
}

interface ContentSection {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
}

interface PageContent {
  eyebrow: string;
  summary: string;
  updatedAt: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  sections: ContentSection[];
}

function pageContent(
  kind: PublicPageKind,
  siteName: string,
  operatorName: string,
): PageContent {
  if (kind === "help") {
    return {
      eyebrow: "使用支持",
      summary: `从账号、项目到云端资产，快速了解 ${siteName} 的常用操作与排查方法。`,
      updatedAt: "2026 年 7 月 29 日",
      icon: LifeBuoy,
      sections: [
        {
          id: "getting-started",
          title: "开始使用",
          paragraphs: [
            "注册账号后即可进入个人云端空间。建议先创建一个项目，再按创作过程添加文本、图片与生成节点。系统会持续保存项目图的增量变更。",
          ],
          items: [
            "使用长期可访问的邮箱注册，并妥善保管登录密码。",
            "为每个独立主题建立项目，避免素材与节点关系混杂。",
            "重要阶段可创建项目检查点，便于后续查看或恢复。",
          ],
        },
        {
          id: "models",
          title: "配置模型服务",
          paragraphs: [
            "模型服务商、接口地址、模型 ID 与 API Key 由你在浏览器的加密 Vault 中配置。Cloud 平台不会代收 API Key，也不会代理模型请求。",
            "如果服务商不允许浏览器跨域访问，请使用你自己控制的固定目标网关，并确保网关只转发受信任的模型服务。",
          ],
        },
        {
          id: "storage",
          title: "项目与存储",
          paragraphs: [
            "个人空间默认提供 10 GiB 存储配额。已完成上传的图片、视频和项目引用会计入用量；达到上限后，新的上传或迁移会暂停，但现有资产不会因此自动删除。",
          ],
          items: [
            "在设置中的存储管理查看总用量和各项目明细。",
            "删除不再使用的项目内容后，系统会按照保留期执行延迟清理。",
            "跨设备使用前，等待当前项目保存完成再关闭页面。",
          ],
        },
        {
          id: "account",
          title: "账号与安全",
          paragraphs: [
            "你可以在个人资料中修改密码、查看登录设备并撤销会话。若无法自行找回账号，可联系站点运营方核验身份后协助重置密码。",
          ],
        },
        {
          id: "troubleshooting",
          title: "常见问题排查",
          items: [
            "页面无法打开：检查网络、域名证书和浏览器时间是否正确。",
            "登录反复失效：清除本站旧 Cookie 后重新登录，并确认没有多个设备争用单一会话。",
            "生成请求失败：确认模型接口、余额、CORS 与模型 ID 均有效。",
            "资产上传失败：检查剩余配额、文件格式和对象存储服务状态。",
          ],
        },
      ],
    };
  }

  if (kind === "terms") {
    return {
      eyebrow: "法律文件",
      summary: `本协议约定你与 ${operatorName} 之间关于使用 ${siteName} 的权利和责任。`,
      updatedAt: "生效日期：2026 年 7 月 29 日",
      icon: FileCheck2,
      sections: [
        {
          id: "acceptance",
          title: "一、协议的接受与适用",
          paragraphs: [
            `当你注册、登录或使用 ${siteName} 时，即表示你已阅读、理解并同意本协议与《隐私政策》。若你不同意其中任何内容，请停止注册或使用服务。`,
            "你应具备与使用行为相适应的民事行为能力；未成年人应在监护人阅读并同意后使用。",
          ],
        },
        {
          id: "service",
          title: "二、服务内容",
          paragraphs: [
            `${siteName} 提供云端项目管理、画布编辑、媒体资产保存以及浏览器侧模型服务连接能力。具体功能、容量和可用范围以页面实际展示为准。`,
            "第三方模型服务由相应服务商独立提供，你应自行取得合法授权、承担相关费用，并遵守该服务商的规则。",
          ],
        },
        {
          id: "account",
          title: "三、账号管理",
          items: [
            "注册信息应真实、准确、有效，并由你持续维护。",
            "账号仅限本人使用，不得出租、出售、转让或以其他方式提供给第三方。",
            "你应妥善保管密码和登录设备；发现异常时应立即修改密码并联系运营方。",
            "因你主动泄露凭据或未尽合理保管义务造成的损失，由你依法承担。",
          ],
        },
        {
          id: "content",
          title: "四、用户内容与知识产权",
          paragraphs: [
            "你保留对合法上传内容及创作成果依法享有的权利。为实现存储、展示、同步、备份和导出功能，你授予平台在提供服务所必需范围内处理相关内容的许可。",
            "你保证上传、处理和生成的内容具有合法来源，不侵犯他人的著作权、商标权、肖像权、隐私权或其他合法权益。",
          ],
        },
        {
          id: "conduct",
          title: "五、使用规范",
          items: [
            "不得利用服务制作、存储或传播违法违规、侵权、欺诈或恶意内容。",
            "不得攻击、干扰、绕过安全限制，或以自动化方式过度消耗系统资源。",
            "不得上传恶意程序，也不得尝试访问其他用户、工作空间或后台数据。",
            "不得将平台用于法律法规禁止或需要特别许可但未取得许可的业务。",
          ],
        },
        {
          id: "availability",
          title: "六、服务变更与责任边界",
          paragraphs: [
            "平台会尽合理努力维持服务稳定，但网络、基础设施、第三方服务、维护或不可抗力可能导致短时中断。对于第三方模型输出的准确性、完整性和适用性，平台不作保证。",
            "如你违反本协议或存在安全风险，平台可依法采取限制功能、暂停账号、删除违法内容或终止服务等措施。",
          ],
        },
        {
          id: "changes",
          title: "七、协议更新与联系",
          paragraphs: [
            "协议发生重要变更时，平台会通过站内页面或其他合理方式提示。更新后的协议自标明日期起生效；继续使用服务视为接受更新内容。",
            "对本协议有疑问，可通过站点公布的问题反馈渠道联系运营方。",
          ],
        },
      ],
    };
  }

  if (kind === "privacy") {
    return {
      eyebrow: "隐私与数据",
      summary: `本政策说明 ${siteName} 如何收集、使用、保存和保护你的个人信息。`,
      updatedAt: "生效日期：2026 年 7 月 29 日",
      icon: ShieldCheck,
      sections: [
        {
          id: "collection",
          title: "一、我们收集的信息",
          items: [
            "账号信息：用户名、邮箱、邮箱验证状态和账号状态。",
            "安全信息：会话、设备标识、登录时间、必要的 IP 与 User-Agent 安全记录。",
            "服务数据：项目结构、节点与连线、检查点、上传资产及其必要元数据。",
            "运行信息：受限的错误分类、请求耗时、结果数量等去敏运营数据。",
          ],
        },
        {
          id: "local-secrets",
          title: "二、模型服务凭据的特殊说明",
          paragraphs: [
            "你的模型服务商、endpoint、真实模型 ID 和 API Key 仅保存在按网站来源与账号隔离的浏览器加密 Vault 中。平台 API 不接收这些凭据，也不提供任意模型代理。",
            "清除浏览器数据、更换设备或丢失 Vault 解锁信息，可能导致这些本地配置无法恢复。",
          ],
        },
        {
          id: "purpose",
          title: "三、信息使用目的",
          items: [
            "创建和维护账号、验证身份并保障登录安全。",
            "保存、同步、展示和恢复你的项目与云端资产。",
            "计算存储配额、排查故障并维护服务稳定性。",
            "履行法律法规要求，防范欺诈、攻击和其他滥用行为。",
          ],
        },
        {
          id: "storage",
          title: "四、保存与保护",
          paragraphs: [
            "账号和项目关系数据保存在 PostgreSQL，媒体文件保存在私有对象存储。密码使用单向安全哈希；会话、验证码和管理密钥按照用途采取签名、哈希或加密保护。",
            "项目与资产采用软删除和延迟清理。仍被当前项目状态或保留检查点引用的资产不会被自动清理。",
          ],
        },
        {
          id: "sharing",
          title: "五、共享与对外提供",
          paragraphs: [
            "我们不会出售你的个人信息。为提供云服务，必要数据可能由受约束的数据库、对象存储、邮件和网络基础设施处理；除此之外，仅在取得授权或法律法规要求时对外提供。",
          ],
        },
        {
          id: "rights",
          title: "六、你的权利",
          items: [
            "查看和更正可维护的账号信息。",
            "查看登录设备、撤销会话并修改密码。",
            "按产品提供的能力导出项目数据或删除项目内容。",
            "就个人信息处理提出查询、更正、删除或注销请求。",
          ],
        },
        {
          id: "updates",
          title: "七、政策更新与联系",
          paragraphs: [
            "本政策更新时会标明新的生效日期。发生重大变化时，我们会通过站内页面或其他合理方式提示。隐私相关问题可通过问题反馈渠道联系运营方。",
          ],
        },
      ],
    };
  }

  return {
    eyebrow: "沟通与改进",
    summary: `遇到问题或有改进建议时，请按以下方式整理信息，帮助 ${operatorName} 更快定位和回复。`,
    updatedAt: "更新日期：2026 年 7 月 29 日",
    icon: MessageSquareText,
    sections: [
      {
        id: "before-feedback",
        title: "反馈前先确认",
        items: [
          "刷新页面并确认网络连接正常，必要时重新登录。",
          "查看帮助中心中是否已有对应的操作说明或排查建议。",
          "确认问题可以稳定复现，并记录发生时间与操作步骤。",
        ],
      },
      {
        id: "what-to-include",
        title: "建议提供的信息",
        items: [
          "问题类型：账号、项目、画布、上传、模型连接或其他。",
          "简明标题和完整复现步骤，以及你预期出现的结果。",
          "浏览器名称与版本、操作系统、发生时间和必要截图。",
          "如涉及具体账号，只提供用户编号；不要公开密码、验证码或 API Key。",
        ],
      },
      {
        id: "security",
        title: "安全与隐私提醒",
        paragraphs: [
          "反馈中不得包含登录密码、邮箱验证码、会话 token、模型 API Key、对象存储密钥或其他敏感凭据。截图前请遮盖邮箱、项目内容和个人信息。",
          "如果你发现可能影响其他用户的数据泄露或安全漏洞，请不要公开传播复现细节，应通过运营方公布的可信渠道单独报告。",
        ],
      },
      {
        id: "handling",
        title: "处理说明",
        paragraphs: [
          "运营方会根据影响范围、复现难度和安全风险安排处理优先级。提交反馈不代表一定采纳或承诺固定完成时间，但有效信息会用于问题排查与产品改进。",
          "若后台配置了独立工单或反馈平台，从网站入口进入后将以该平台公布的提交与回复流程为准。",
        ],
      },
    ],
  };
}

export function PublicContentPage({ kind }: PublicContentPageProps) {
  const [site, setSite] =
    useState<PublicSiteConfigResponse>(FALLBACK_SITE_CONFIG);

  useEffect(() => {
    let active = true;
    void fetchPublicSiteConfig().then((value) => {
      if (!active) return;
      setSite(value);
      document.title = `${PUBLIC_PAGE_META[kind].label} - ${value.config.siteName}`;
      document.documentElement.dataset.siteThemePreset =
        value.config.themePreset;
    });
    return () => {
      active = false;
    };
  }, [kind]);

  const config = site.config;
  const operatorName = config.records.companyName ?? config.siteName;
  const content = useMemo(
    () => pageContent(kind, config.siteName, operatorName),
    [config.siteName, kind, operatorName],
  );
  const logoUrl = site.assets.logo?.url ?? "/brand/ai-canvas-mark.png";
  const PageIcon = content.icon;

  return (
    <main className="public-doc-shell">
      <header className="public-doc-header">
        <a className="public-doc-brand" href="/">
          <img src={logoUrl} alt="" width="34" height="34" />
          <span>{config.shortName}</span>
        </a>
        <nav aria-label="公共页面">
          {PUBLIC_PAGE_ORDER.map((item) => (
            <a
              key={item}
              href={getPublicPageHref(config, item)}
              aria-current={item === kind ? "page" : undefined}
            >
              {PUBLIC_PAGE_META[item].label}
            </a>
          ))}
        </nav>
        <a className="public-doc-back" href="/">
          <ArrowLeft aria-hidden="true" />
          返回首页
        </a>
      </header>

      <div className="public-doc-layout">
        <aside className="public-doc-toc" aria-label="本页目录">
          <div className="public-doc-toc__label">
            <BookOpenText aria-hidden="true" />
            本页目录
          </div>
          {content.sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </aside>

        <article className="public-doc-article">
          <header className="public-doc-title">
            <div className="public-doc-title__icon">
              <PageIcon size={22} aria-hidden={true} />
            </div>
            <p>{content.eyebrow}</p>
            <h1>{PUBLIC_PAGE_META[kind].label}</h1>
            <div className="public-doc-title__rule" />
            <p className="public-doc-title__summary">{content.summary}</p>
            <time>{content.updatedAt}</time>
          </header>

          <div className="public-doc-sections">
            {content.sections.map((section) => (
              <section key={section.id} id={section.id}>
                <h2>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.items ? (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </div>

      <footer className="public-doc-footer">
        <span>{config.footer.copyright}</span>
        <span>{operatorName}</span>
      </footer>
    </main>
  );
}
