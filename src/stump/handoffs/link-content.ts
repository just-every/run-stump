// A hand-off's utm_content: the first 8 characters of its id, so the text a
// member copies stays readable; the brief and the recorded post use the same tag.
export const shortContent = (handoffId: string) => handoffId.replace(/-/g, '').slice(0, 8)
