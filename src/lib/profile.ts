export interface ProfileLike {
	alias?: string;
	displayName?: string;
	pub?: string;
}

export const PROFILE_LIMITS = {
	displayName: 32,
	bio: 280,
	avatarSize: 256
} as const;

export function displayNameOf(profile?: ProfileLike | null): string {
	const displayName = profile?.displayName?.trim();
	if (displayName) return displayName;

	const alias = profile?.alias?.trim();
	if (alias) return alias;

	return profile?.pub ?? "Unknown";
}
