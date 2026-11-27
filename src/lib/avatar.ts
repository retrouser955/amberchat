import { PROFILE_LIMITS } from "./profile";

/**
 * Resize an uploaded image to a small square-ish avatar and return a data URL.
 * Browser-only: uses Image, canvas and URL.createObjectURL.
 */
export async function fileToAvatarDataUrl(
	file: File,
	maxSize = PROFILE_LIMITS.avatarSize
): Promise<string> {
	if (!file.type.startsWith("image/")) {
		throw new Error("Choose an image file.");
	}

	if (file.size > 8 * 1024 * 1024) {
		throw new Error("Image must be smaller than 8 MB.");
	}

	const objectUrl = URL.createObjectURL(file);

	try {
		const image = await loadImage(objectUrl);
		const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
		const width = Math.max(1, Math.round(image.width * scale));
		const height = Math.max(1, Math.round(image.height * scale));

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;

		const context = canvas.getContext("2d");
		if (!context) throw new Error("Could not process that image.");

		// JPEG has no alpha; fill with the panel colour so transparent PNGs do
		// not turn black.
		context.fillStyle = "#2b2d31";
		context.fillRect(0, 0, width, height);
		context.drawImage(image, 0, 0, width, height);

		return canvas.toDataURL("image/jpeg", 0.85);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Could not read that image."));
		image.src = src;
	});
}
