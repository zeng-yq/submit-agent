/** 域名规范化：去协议/路径/查询/锚点/端口、小写、去 www 前缀。非法输入抛出含原值的错误。 */
export function normalizeDomain(input: string): string {
	const raw = input.trim()
	const withoutProtocol = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
	const hostPart = withoutProtocol.split(/[/?#]/)[0] ?? ''
	const withoutPort = hostPart.split(':')[0] ?? ''
	const domain = withoutPort.toLowerCase().replace(/^www\./, '')
	const isValid = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
	if (!domain || !isValid) {
		throw new Error(`无法从输入解析出域名: "${raw}"`)
	}
	return domain
}
