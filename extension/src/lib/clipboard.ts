/** 剪贴板写入：文本与图片（图片统一转 PNG，Chrome 剪贴板仅支持 image/png）。 */

export async function copyText(value: string): Promise<void> {
	await navigator.clipboard.writeText(value)
}

export async function copyImageAsPng(dataUrl: string): Promise<void> {
	const blob = await (await fetch(dataUrl)).blob()

	if (blob.type === 'image/png') {
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
		return
	}

	const bitmap = await createImageBitmap(blob)
	const canvas = document.createElement('canvas')
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	const context = canvas.getContext('2d')
	if (!context) {
		throw new Error(`无法创建画布上下文 (${blob.type}, ${blob.size} bytes)`)
	}
	context.drawImage(bitmap, 0, 0)
	const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
	if (!pngBlob) {
		throw new Error(`图片转 PNG 失败 (${blob.type}, ${blob.size} bytes)`)
	}
	await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
}
