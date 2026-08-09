import type {
  InteriorConversionGoal,
  InteriorConversionLogic,
  InteriorDesignConfigV1,
  InteriorOption,
  InteriorPreset,
  InteriorPresetId,
  InteriorSourceSoftware,
} from "./types";

const option = <T extends string>(
  id: T,
  label: string,
  prompt: string,
): InteriorOption<T> => ({ id, label, prompt });

export const SOURCE_SOFTWARE_OPTIONS = [
  option("sketchup", "SketchUp", "SketchUp 软件模型截图"),
  option("kujiale", "酷家乐", "酷家乐软件模型截图"),
  option("3ds-max", "3ds Max", "3ds Max 软件模型截图"),
  option("existing-render", "现有效果图", "已有室内设计效果图"),
  option("custom", "其他", "用户指定来源"),
] satisfies InteriorOption<InteriorSourceSoftware>[];

export const CONVERSION_GOAL_OPTIONS = [
  option(
    "photoreal-photo",
    "真实摄影照片",
    "转换为可信的室内建筑摄影照片，以现实材料、物理光照和相机成像为准",
  ),
  option(
    "realistic-visualization",
    "写实商业效果图",
    "转换为高完成度的写实商业表现图，兼顾设计表达、材质层次和空间氛围",
  ),
  option("custom", "➕ 自定义", "用户自定义图生图任务类型"),
] satisfies InteriorOption<InteriorConversionGoal>[];

export const CONVERSION_LOGIC_OPTIONS = [
  option(
    "pbr-photoreal",
    "真实摄影照片（PBR超写实物理材质）",
    "基于模型截图进行写实转换，将所有模型表面替换为高精度 PBR 物理写实材质，严格遵循物理渲染原理，光影、反射、折射完全物理正确，具备真实粗糙度、金属度与法线细节，材质表现完全符合现实世界物理规律。",
  ),
  option(
    "realistic-visualization",
    "写实效果图",
    "由模型截图渲染生成高清超写实照片级室内效果图，核心强化多层自然光影、明暗过渡层次与精细表面肌理，完全还原真实物理光照、光线追踪 Ray Tracing、全局光照 GI、柔和漫反射与真实阴影，高精度 PBR 物理材质，表面纹理细腻丰富，质感高度逼真，物理渲染完全正确。",
  ),
  option("custom", "➕ 自定义", "用户自定义转换逻辑"),
] satisfies InteriorOption<InteriorConversionLogic>[];

export const SPACE_TYPE_OPTIONS = [
  option("flat-home", "平层家装", "平层住宅室内空间"),
  option("loft-home", "LOFT 家装", "LOFT 复式住宅室内空间"),
  option("villa-home", "别墅家装", "别墅住宅室内空间"),
  option("office", "办公空间", "办公与协作空间"),
  option("retail", "零售展示", "零售、展陈与品牌展示空间"),
  option("dining", "餐饮空间", "餐厅、咖啡馆或酒吧空间"),
  option("hotel", "酒店住宿", "酒店大堂、客房或公共空间"),
  option("education-medical", "教育医疗", "教育或医疗功能空间"),
  option("culture-art", "文化艺术", "文化、艺术或展览空间"),
  option("manufacturing", "生产制造", "生产、制造或工业功能空间"),
  option("basement-enclosed", "地下室封闭空间", "无自然采光的地下封闭空间"),
  option("commercial-enclosed", "工装封闭空间", "无自然采光的商业封闭空间"),
  option("courtyard", "庭院空间", "住宅庭院与关联的半室外空间"),
  option("storefront", "室外门头", "商铺门头与入口展示空间"),
  option("villa-exterior", "别墅外立面", "别墅或自建房外立面空间"),
  option("generic-outdoor", "通用室外", "通用建筑室外空间"),
  option("commercial", "商业工装空间", "商业综合体及公共工装空间"),
  option("custom", "➕ 自定义", "用户自定义空间类型"),
];

export const DESIGN_STYLE_OPTIONS = [
  option("modern-general", "现代通用", "现代室内设计，比例克制、线条清晰"),
  option("modern-minimal", "现代简约", "现代简约风格，减少装饰并突出功能秩序"),
  option("modern-minimalism", "现代极简", "现代极简主义，纯净体块与精确细部"),
  option("bauhaus", "包豪斯", "包豪斯风格，功能主义与几何秩序"),
  option("italian-minimal", "意式极简", "意式极简风格，低饱和材质与精致比例"),
  option("modern-luxury", "现代轻奢", "现代轻奢风格，克制金属与高级石材点缀"),
  option("modern-wood", "现代原木", "现代原木风格，自然木质与柔和中性色"),
  option("light-french", "轻法式", "轻法式风格，精简线脚与柔和优雅比例"),
  option("classic-french", "古典法式", "古典法式风格，对称秩序与精致装饰"),
  option("modern-european", "现代欧式", "现代欧式风格，经典比例与现代材料结合"),
  option("cream-french", "奶油法式", "奶油法式风格，柔和浅色与细腻曲线"),
  option("american", "美式", "美式室内风格，舒适尺度与温润材料"),
  option("mediterranean", "地中海", "地中海风格，自然肌理与明快通风感"),
  option("neo-classical", "新古典", "新古典风格，古典比例与简化装饰"),
  option("new-chinese", "新中式", "新中式风格，东方秩序与当代材质"),
  option("song-chinese", "宋式新中式", "宋式新中式，清雅留白与文人气质"),
  option("zen-chinese", "禅意新中式", "禅意新中式，安静留白与自然材料"),
  option("nordic", "现代北欧", "现代北欧风格，明亮实用与轻盈家具"),
  option("japanese", "现代日式", "现代日式风格，克制收纳与自然触感"),
  option("wabi-sabi", "侘寂", "侘寂风格，朴素材料、自然缺陷与安静光线"),
  option("cream", "奶油风", "奶油风格，柔软圆角与低对比暖白色系"),
  option("french-luxury", "法式轻奢", "法式线脚与精致轻奢材质"),
  option("baroque", "巴洛克风", "戏剧性曲线、雕饰与浓郁层次"),
  option("rococo", "洛可可风", "轻盈曲线、柔和色彩与精巧装饰"),
  option("traditional-chinese", "传统明清中式", "传统中式比例、木作与对称秩序"),
  option("nordic-wood", "原木北欧风", "自然原木、明亮留白与功能主义"),
  option("nordic-luxury", "北欧轻奢风", "北欧简洁与精致金属材质结合"),
  option("japanese-wood", "原木日式风", "原木、留白与自然材质"),
  option("japanese-zen", "日式禅意风", "克制、留白与禅意自然氛围"),
  option("outdoor-general", "现代室外设计", "现代建筑与室外空间设计"),
  option("commercial-general", "现代商业工装设计", "现代商业空间设计语言"),
  option("courtyard-general", "通用庭院风格", "适配庭院与景观空间的通用风格"),
  option("custom", "➕ 自定义", "用户自定义设计风格"),
];

export const EXTERIOR_VIEW_OPTIONS = [
  option("community-high", "高层小区", "高楼层小区与远处城市天际线"),
  option("community-mid", "中层小区", "中楼层社区绿化与邻近建筑"),
  option("community-low", "低层小区", "低楼层社区庭院与近景绿植"),
  option("river", "江景", "开阔江面、滨水岸线与远景城市"),
  option("lake", "湖景", "平静湖面、自然岸线与远景绿化"),
  option("sea", "海景", "开阔海面、自然天际线与沿岸景观"),
  option("mountain", "山景", "层叠山体与自然植被远景"),
  option("park", "公园绿植", "公园、成熟乔木与连续绿植景观"),
  option("city-skyline", "城市天际线", "清晰但不过度抢眼的城市天际线"),
  option("city-night", "城市夜景", "真实城市夜景与建筑灯光"),
  option("courtyard", "庭院", "尺度真实的住宅庭院与景观绿植"),
  option("street", "临街商铺", "真实临街界面、道路与城市生活环境"),
  option("enclosed", "封闭空间无外景", "无窗、无室外景观的封闭空间"),
  option("campus", "校园景", "校园建筑与绿化景观"),
  option("wetland", "湿地景观", "湿地水系与自然植被"),
  option("valley", "山谷景", "山谷地形与远景层次"),
  option("snow", "雪景", "冬季积雪与冷色环境"),
  option("villa-background", "别墅/自建房背景", "别墅或自建房周边环境"),
  option("villa-courtyard", "别墅/庭院背景", "别墅庭院与景观背景"),
  option("shopfront", "商铺/门头背景", "商铺门头与街道背景"),
  option("night-shopfront", "夜晚商铺外景", "夜间商业街道与灯光"),
  option("hongkong-street", "港式街道外景", "港式街区与城市生活氛围"),
  option("misty-mountain", "深山烟雨", "低饱和灰蓝烟雨山景"),
  option("autumn-mountain", "秋日深山庭院", "暖调秋日枫红庭院"),
  option("snow-night-courtyard", "雪夜深山庭院", "冷调静谧雪夜庭院"),
  option("jiangnan-courtyard", "江南烟雨庭院", "水墨诗意江南庭院"),
  option("dry-courtyard", "日式枯山水庭院", "极简禅意枯山水庭院"),
  option("bamboo-courtyard", "晨曦竹林庭院", "清新治愈竹林庭院"),
  option("starry-courtyard", "星空萤火庭院", "梦幻浪漫夜间庭院"),
  option("cherry-courtyard", "春樱漫舞庭院", "柔美浪漫樱花庭院"),
  option("stone-courtyard", "山居石径庭院", "古朴野趣山居庭院"),
  option("custom", "➕ 自定义", "用户自定义外景类型"),
];

export const LOCATION_OPTIONS = [
  option("auto", "自动适配", "依据空间、气候和外景自动匹配合理地域"),
  option("beijing", "北京", "中国北京"),
  option("shanghai", "上海", "中国上海"),
  option("hangzhou", "杭州", "中国杭州"),
  option("nanjing", "南京", "中国南京"),
  option("chengdu", "成都", "中国成都"),
  option("chongqing", "重庆", "中国重庆"),
  option("kunming", "昆明", "中国昆明"),
  option("guangzhou", "广州", "中国广州"),
  option("haikou", "海口", "中国海口"),
  option("hong-kong", "香港", "中国香港"),
  option("enclosed", "封闭空间", "封闭室内，不设地域性外景"),
  option("harbin", "哈尔滨", "中国哈尔滨"),
  option("urumqi", "乌鲁木齐", "中国乌鲁木齐"),
  option("changsha", "长沙", "中国长沙"),
  option("taipei", "台北", "中国台北"),
  option("core-business", "城市核心商圈", "城市核心商业区"),
  option("southern-mountain", "南方深山地区", "南方山地气候与自然环境"),
  option("custom", "➕ 自定义", "用户自定义地点"),
];

export const SEASON_OPTIONS = [
  option("auto", "自动", "依据地点与场景自动匹配季节"),
  option("spring", "春季", "春季"),
  option("summer", "夏季", "夏季"),
  option("autumn", "秋季", "秋季"),
  option("winter", "冬季", "冬季"),
  option("custom", "➕ 自定义", "用户自定义季节"),
];

export const WEATHER_OPTIONS = [
  option("auto", "自动", "依据预设自动匹配天气"),
  option("sunny", "晴天", "晴朗天气，空气通透"),
  option("cloudy", "阴天", "阴天漫射天光，光比柔和"),
  option("foggy", "雾天", "轻雾天气，远景层次自然衰减"),
  option("rainy", "雨天", "雨天湿润环境与柔和漫射光"),
  option("snowy", "雪天", "雪天冷色环境光与真实积雪反射"),
  option("windy", "风天", "风天动态植被与空气氛围"),
  option("custom", "➕ 自定义", "用户自定义天气"),
];

export const TIME_OPTIONS = [
  option("late-night", "凌晨2点", "凌晨两点"),
  option("pre-dawn", "黎明4点", "黎明四点"),
  option("dawn", "清晨 6 点", "清晨六点"),
  option("morning", "上午 9 点", "上午九点"),
  option("noon", "中午 12 点", "中午十二点"),
  option("afternoon", "下午 4 点", "下午四点"),
  option("sunset", "日落 5 点", "日落前后的黄金时刻"),
  option("evening", "傍晚 6 点", "傍晚蓝调时刻"),
  option("night", "夜晚 8 点", "夜晚八点"),
  option("late-evening", "晚上19点", "晚上七点"),
  option("midnight", "深夜24点", "深夜零点"),
  option("custom", "➕ 自定义", "用户自定义时间段"),
];

export const CURTAIN_OPTIONS = [
  option(
    "as-modeled",
    "保持原图",
    "准确识别并保持模型图中的窗帘类型与开合状态",
  ),
  option("sheer-closed", "单层纱帘关闭", "关闭的单层半透纱帘"),
  option("sheer-open", "单层纱帘打开", "打开的单层纱帘"),
  option("double-open", "双层窗帘打开", "打开的布帘与纱帘双层窗帘"),
  option("shangri-la", "香格里拉帘", "香格里拉帘，叶片角度真实"),
  option("dream", "梦幻帘", "垂直梦幻帘，帘片排列自然"),
  option("none", "无窗帘", "无窗帘，保持原始门窗结构"),
  option("door-open", "无窗帘，有落地窗平开门", "无窗帘，保留落地窗和平开门"),
  option("custom", "➕ 自定义", "用户自定义窗帘类型"),
];

export const SUNLIGHT_OPTIONS = [
  option("none", "无太阳直射", "无直射阳光与光斑，仅保留均匀自然漫射光"),
  option("clean", "自然阳光", "方向明确、强度克制的自然阳光和真实阴影"),
  option("tree", "树影斑驳", "窗外树木投射细密自然且尺度合理的斑驳树影"),
  option(
    "shangri-la",
    "香格里拉帘影",
    "香格里拉帘形成连续、方向一致的条纹光影",
  ),
  option("dream", "梦幻帘影", "梦幻帘形成柔和竖向光影与渐变"),
  option("sheer", "纱帘柔光", "阳光经过纱帘形成柔和、无硬边的漫射光"),
  option("tyndall", "丁达尔光", "可控的体积光束，方向与窗户位置严格一致"),
  option("top-spots", "顶部光斑", "顶部自然光斑与柔和反射"),
  option("outdoor-tree", "室外晴天树影", "窗外晴天树影投射"),
  option("outdoor-cloudy", "室外阴天", "窗外阴天漫射光"),
  option("custom", "➕ 自定义", "用户自定义太阳光影"),
];

export const INTERIOR_LIGHT_OPTIONS = [
  option("natural-only", "仅自然光", "关闭室内人工灯光，仅使用自然光"),
  option("ceiling", "天花灯全开", "开启天花射灯、吊灯与灯带，亮度自然"),
  option("all", "室内光全开", "开启功能照明与氛围照明，层次清晰不过曝"),
  option("ambient", "仅氛围灯", "仅开启装饰性和氛围灯光"),
  option(
    "enclosed",
    "封闭空间照明",
    "以功能照明为主完整照亮封闭空间，暗部保留细节",
  ),
  option("commercial", "工装功能灯全开", "开启全部商业功能照明并保持真实照度"),
  option("custom", "➕ 自定义", "用户自定义室内光"),
];

export const COLOR_TEMPERATURE_OPTIONS = [
  option("6000k", "冷白光 6000K", "整体人工光色温约 6000K"),
  option("4500k", "中性光 4500K", "整体人工光色温约 4500K"),
  option("3500k", "暖白光 3500K", "整体人工光色温约 3500K"),
  option("2800k", "暖黄光 2800K", "整体人工光色温约 2800K"),
  option(
    "teal-orange",
    "青橙对比",
    "室外冷青环境光与室内暖橙人工光形成克制对比",
  ),
  option("custom", "➕ 自定义", "用户自定义灯光色温"),
];

export const COLOR_GRADING_OPTIONS = [
  option("neutral-warm", "中性微暖", "中性微暖后期，准确还原材质本色"),
  option("warm-documentary", "暖调纪实", "暖调纪实色彩，肤色与木材自然"),
  option("cool-documentary", "冷调纪实", "冷调纪实色彩，白平衡稳定"),
  option("film", "电影胶片", "克制的电影胶片色彩与细微颗粒"),
  option("white-neutral", "白中性", "干净白中性色彩，不偏青不偏黄"),
  option("teal-orange", "青橙调色", "低饱和青橙对比调色"),
  option("gray-blue", "低饱和灰蓝烟雨色调", "低饱和灰蓝烟雨色调"),
  option("custom", "➕ 自定义", "用户自定义后期色调"),
];

export const TONAL_QUALITY_OPTIONS = [
  option("soft-documentary", "柔和纪实", "柔和纪实影调，明暗过渡自然"),
  option("warm-soft", "温润柔焦", "温润柔焦影调，保留材质细节"),
  option("clear-crisp", "清透硬朗", "清透硬朗影调，对比明确但不过锐"),
  option("cinematic", "电影质感", "电影级影调，层次丰富且高光受控"),
  option("natural", "自然纪实", "自然纪实影调，最少后期干预"),
  option("teal-orange", "青橙对比", "青橙对比影调，冷暖层次明确"),
  option("gray-blue", "低饱和灰蓝烟雨影调", "低饱和灰蓝烟雨影调"),
  option("custom", "➕ 自定义", "用户自定义光影品质"),
];

export const OCCUPANT_OPTIONS = [
  option("none", "无人物宠物", "不添加人物或宠物"),
  option(
    "relaxed-person",
    "居家松弛人物",
    "加入一名姿态自然的居家人物，不遮挡空间重点",
  ),
  option("parent-child", "亲子人物", "加入自然互动的亲子人物，尺度和光影准确"),
  option(
    "motion-person",
    "动态虚影人物",
    "加入一名长曝光动态虚影人物，无清晰面部特写",
  ),
  option("cat", "一只猫", "加入一只尺度真实、姿态自然的猫"),
  option("dog", "一只狗", "加入一只尺度真实、姿态自然的狗"),
  option("zen-person", "禅意雅致文人风人物", "加入禅意雅致的文人风人物"),
  option("family-person", "亲子空间人物", "加入自然互动的亲子人物"),
  option("wood-relaxed", "原木风慵懒松弛人物", "加入原木风居家人物"),
  option("bedroom-relaxed", "卧室慵懒风人物", "加入卧室休闲人物"),
  option("motion-person-2", "2位动态虚影人物", "加入两位长曝光动态虚影人物"),
  option("custom", "➕ 自定义", "用户自定义人物或宠物"),
];

export const CAMERA_OPTIONS = [
  option(
    "hasselblad-x2d",
    "Hasselblad X2D 100C",
    "Hasselblad X2D 100C 中画幅相机",
  ),
  option("fuji-gfx", "Fuji GFX 100S", "Fuji GFX 100S 中画幅相机"),
  option("nikon-z9", "Nikon Z9", "Nikon Z9 全画幅相机"),
  option("sony-a7rv", "Sony A7R V", "Sony A7R V 全画幅相机"),
  option("canon-r5", "Canon R5", "Canon R5 全画幅相机"),
  option("iphone", "iPhone Pro", "高端手机主摄的自然计算摄影效果"),
  option("leica-m11", "Leica M11", "Leica M11 全画幅相机"),
  option("iphone17", "iPhone17 pro max", "iPhone17 pro max 主摄计算摄影"),
  option("custom", "➕ 自定义", "用户自定义相机型号"),
];

export const APERTURE_OPTIONS = [
  option("f1.4", "f/1.4", "f/1.4 超大光圈"),
  option("f2.8", "f/2.8", "f/2.8 大光圈"),
  option("f5.6", "f/5.6", "f/5.6 均衡光圈"),
  option("f8", "f/8", "f/8 建筑摄影常用光圈"),
  option("f11", "f/11", "f/11 大景深光圈"),
  option("phone-f1.6", "主摄 f/1.6（手机专用）", "手机主摄 f/1.6"),
  option("custom", "➕ 自定义", "用户自定义光圈"),
];

export const SHUTTER_OPTIONS = [
  option("1/1000s", "1/1000s", "极速快门"),
  option("1/250s", "1/250s", "1/250 秒快门"),
  option("1/60s", "1/60s", "1/60 秒快门"),
  option("1/30s", "1/30s", "1/30 秒慢速快门"),
  option("1s", "1s", "1 秒长曝光"),
  option("5s", "5s", "5 秒长曝光"),
  option("30s", "30s", "30 秒超长曝光"),
  option("1/15s", "1/15s（手机专用）", "手机低速快门"),
  option("custom", "➕ 自定义", "用户自定义快门速度"),
];

export const ISO_OPTIONS = [
  option("50", "ISO 50", "ISO 50"),
  option("100", "ISO 100", "ISO 100"),
  option("200", "ISO 200", "ISO 200"),
  option("400", "ISO 400", "ISO 400"),
  option("800", "ISO 800", "ISO 800"),
  option("1600", "ISO 1600", "ISO 1600"),
  option("custom", "➕ 自定义", "用户自定义 ISO"),
];

export const FOCAL_LENGTH_OPTIONS = [
  option("13mm", "13mm 超广角", "13mm 全画幅等效超广角，控制边缘畸变"),
  option("24mm", "24mm 广角", "24mm 全画幅等效焦距"),
  option("28mm", "28mm 广角", "28mm 全画幅等效焦距"),
  option("48mm", "48mm 标准", "48mm 全画幅等效焦距"),
  option("90mm", "90mm 中长焦", "90mm 全画幅等效焦距"),
  option("135mm", "135mm 长焦", "135mm 全画幅等效焦距"),
  option("custom", "➕ 自定义", "用户自定义焦距"),
];

export const TECHNIQUE_OPTIONS = [
  option("single-shot", "单张直出", "单张直出，保留自然细节"),
  option("natural-imperfection", "真实瑕疵", "保留轻微真实镜头与材料瑕疵"),
  option("hdr", "HDR 包围曝光", "HDR 包围曝光，窗外不过曝、暗部不死黑"),
  option("tilt-shift", "移轴矫正", "移轴透视矫正，建筑竖线保持垂直"),
  option("tripod", "三脚架长曝", "稳定三脚架长曝光"),
  option("custom", "➕ 自定义", "用户自定义拍摄技法"),
];

export const GEOMETRY_OPTIONS = [
  option(
    "strict",
    "强制几何保真",
    "固定空间结构、门窗、家具尺寸、位置、透视和比例，禁止形变或重构",
  ),
  option(
    "local-adjust",
    "允许局部微调",
    "保持主要几何与空间结构，仅允许不影响设计逻辑的局部微调",
  ),
  option("hard-finish", "硬装不动", "禁止改动硬装和建筑结构，允许优化家具布局"),
  option("custom", "➕ 自定义", "用户自定义几何保真约束"),
];

export const OBJECT_OPTIONS = [
  option("strict", "物体完全一致", "保留全部原有物体，禁止新增、删除或替换"),
  option("add-soft", "只增配软装", "保留全部原有物体，仅允许增加少量软装"),
  option(
    "replace-soft",
    "允许替换软装",
    "硬装保持一致，允许替换可移动家具与软装",
  ),
  option("replace-all", "允许整体替换", "保持建筑结构，允许替换软装与饰面材料"),
  option("custom", "➕ 自定义", "用户自定义物体一致性约束"),
];

export const MATERIAL_OPTIONS = [
  option("strict", "材质完整一致", "准确还原模型贴图的颜色、纹理和材料分区"),
  option(
    "optimize",
    "允许优化材质",
    "保持材料类型与分区，提升纹理尺度、粗糙度和物理质感",
  ),
  option("custom", "➕ 自定义", "用户自定义材质一致性约束"),
];

export const ASPECT_RATIO_OPTIONS = [
  option("original", "保持原图比例", "100% 保持输入图片比例与构图"),
  option("16:9", "16:9 横构图", "16:9 横向构图"),
  option("4:3", "4:3 横构图", "4:3 横向构图"),
  option("1:1", "1:1 方形", "1:1 方形构图"),
  option("3:4", "3:4 竖构图", "3:4 竖向构图"),
  option("9:16", "9:16 竖构图", "9:16 竖向构图"),
  option("custom", "➕ 自定义", "用户自定义出图比例"),
];

export const PROMPT_RESOLUTION_OPTIONS = [
  option("4K", "4K", "4K 超高清细节描述"),
  option("8K", "8K", "8K 级超精细完整细节描述"),
  option("custom", "➕ 自定义", "用户自定义分辨率"),
];

export const DEFAULT_INTERIOR_CONFIG: InteriorDesignConfigV1 = {
  schemaVersion: 1,
  presetId: "diffuse-daylight",
  sourceSoftware: "sketchup",
  customSourceSoftware: "",
  conversionGoal: "photoreal-photo",
  conversionLogic: "pbr-photoreal",
  scene: {
    spaceType: "flat-home",
    designStyle: "modern-general",
    exteriorView: "community-high",
    location: "nanjing",
  },
  lighting: {
    season: "summer",
    weather: "cloudy",
    timeOfDay: "morning",
    curtainType: "as-modeled",
    lightEntryEnabled: true,
    sunlightEffect: "none",
    interiorLight: "natural-only",
    colorTemperature: "4500k",
    colorGrading: "neutral-warm",
    tonalQuality: "natural",
    occupants: "none",
  },
  photography: {
    camera: "hasselblad-x2d",
    aperture: "f8",
    shutterSpeed: "1s",
    iso: "100",
    focalLength: "24mm",
    techniques: ["single-shot", "tilt-shift"],
  },
  constraints: {
    geometryFidelity: "strict",
    objectConsistency: "strict",
    materialConsistency: "strict",
    materialDefinition:
      "准确识别并还原模型中的全部可见材料分区、颜色与纹理尺度",
  },
  output: { aspectRatio: "original", promptResolution: "8K" },
  customRequirement: "",
  customSelections: {},
};

function preset(
  id: InteriorPresetId,
  label: string,
  description: string,
  patch: Partial<Omit<InteriorDesignConfigV1, "scene" | "lighting">> & {
    scene?: Partial<InteriorDesignConfigV1["scene"]>;
    lighting?: Partial<InteriorDesignConfigV1["lighting"]>;
  },
): InteriorPreset {
  return {
    id,
    label,
    description,
    config: {
      ...DEFAULT_INTERIOR_CONFIG,
      ...patch,
      presetId: id,
      scene: { ...DEFAULT_INTERIOR_CONFIG.scene, ...patch.scene },
      lighting: { ...DEFAULT_INTERIOR_CONFIG.lighting, ...patch.lighting },
      photography: { ...DEFAULT_INTERIOR_CONFIG.photography },
      constraints: { ...DEFAULT_INTERIOR_CONFIG.constraints },
      output: { ...DEFAULT_INTERIOR_CONFIG.output },
    },
  };
}

export const INTERIOR_PRESETS: InteriorPreset[] = [
  preset("diffuse-daylight", "无直射自然光", "柔和漫射天光，室内人工光关闭。", {
    lighting: {
      weather: "cloudy",
      sunlightEffect: "none",
      interiorLight: "natural-only",
    },
  }),
  preset("natural-sunlight", "自然阳光", "真实阳光进入室内，保持克制光比。", {
    lighting: {
      weather: "sunny",
      sunlightEffect: "clean",
      interiorLight: "natural-only",
    },
  }),
  preset(
    "mixed-lighting",
    "自然光 + 人工光",
    "自然采光与室内功能照明共同工作。",
    {
      lighting: {
        weather: "sunny",
        sunlightEffect: "clean",
        interiorLight: "all",
        colorTemperature: "3500k",
      },
    },
  ),
  preset("tree-shadow", "树影斑驳", "窗外树影投射到室内表面。", {
    lighting: {
      weather: "sunny",
      sunlightEffect: "tree",
      interiorLight: "natural-only",
    },
  }),
  preset("curtain-shadow", "帘影氛围", "通过帘片形成有方向的柔和光影。", {
    lighting: {
      weather: "sunny",
      curtainType: "shangri-la",
      sunlightEffect: "shangri-la",
      interiorLight: "natural-only",
    },
  }),
  preset(
    "enclosed-artificial",
    "封闭空间人工光",
    "封闭空间以完整人工照明塑造层次。",
    {
      scene: {
        spaceType: "commercial-enclosed",
        exteriorView: "enclosed",
        location: "enclosed",
      },
      lighting: {
        weather: "auto",
        curtainType: "none",
        lightEntryEnabled: false,
        sunlightEffect: "none",
        interiorLight: "enclosed",
        colorTemperature: "3500k",
      },
    },
  ),
];

export function getInteriorPreset(id: InteriorPresetId) {
  return (
    INTERIOR_PRESETS.find((item) => item.id === id) ?? INTERIOR_PRESETS[0]!
  );
}

export function applyInteriorPreset(
  current: InteriorDesignConfigV1,
  id: InteriorPresetId,
): InteriorDesignConfigV1 {
  const next = structuredClone(getInteriorPreset(id).config);
  next.sourceSoftware = current.sourceSoftware;
  next.customSourceSoftware = current.customSourceSoftware;
  next.conversionGoal = current.conversionGoal;
  next.conversionLogic = current.conversionLogic;
  next.customRequirement = current.customRequirement;
  next.customSelections = { ...(current.customSelections ?? {}) };
  return next;
}

export function findInteriorOption<T extends string>(
  options: InteriorOption<T>[],
  id: string,
) {
  return options.find((item) => item.id === id) ?? options[0]!;
}
