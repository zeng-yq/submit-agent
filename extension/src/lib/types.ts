/** LLM 配置。端点固定，模型按供应商存于 storage（空值回退内置默认），API Key 由用户配置。 */
export interface LLMSettings {
	apiKey: string
	baseUrl: string
	model: string
}

/**
 * 产品：用户推广的一个网站，所有资料与文案的载体（见 GLOSSARY.md）。
 * 基本信息抓取自产品首页，可人工修改；analysis/intro/description 由 LLM 产出。
 */
export interface Product {
	id: string
	/** 裸域名，如 example.com（输入时已去协议/路径/www 前缀） */
	domain: string
	/** 网站名 */
	name: string
	/** 网站首页 URL，如 https://example.com */
	url: string
	/** logo，dataURL；首页抓不到则为空，用户可手动上传 */
	logoDataUrl?: string
	/** og 宣传封面图，dataURL；首页抓不到则为空，用户可手动上传 */
	ogDataUrl?: string
	/** 联系邮箱，默认 support@裸域名 */
	email: string
	/** 产品分析：添加产品时 LLM 基于首页内容生成的定位素材，后续文案生成的原料 */
	analysis?: string
	/** 最近一次生成的简介（英文，≤300 字符），仅用于展示缓存 */
	intro?: string
	/** 最近一次生成的详述（markdown，≤1000 字符，含 1～3 个产品域名链接），仅用于展示缓存 */
	description?: string
	createdAt: number
	updatedAt: number
}
