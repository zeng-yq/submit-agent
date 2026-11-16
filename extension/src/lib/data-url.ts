/** Blob/File 转 dataURL（FileReader 包装）。 */
export function readBlobAsDataUrl(blob: Blob): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(reader.error ?? new Error(`读取数据失败 (${blob.type}, ${blob.size} bytes)`))
		reader.readAsDataURL(blob)
	})
}
