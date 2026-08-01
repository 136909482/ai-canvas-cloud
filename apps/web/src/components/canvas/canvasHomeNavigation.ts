type ConfirmHomeNavigation = (options: {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "danger";
}) => Promise<boolean>;

export async function confirmReturnHome(
  hasUnsavedChanges: boolean,
  confirm: ConfirmHomeNavigation,
) {
  if (!hasUnsavedChanges) {
    return true;
  }

  return confirm({
    title: "返回首页",
    message: "当前更改尚未同步到云端，返回首页可能丢失这些更改。",
    confirmLabel: "仍然返回",
    tone: "danger",
  });
}
