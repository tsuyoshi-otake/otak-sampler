// Build a verbose, copy-pasteable error message for loopback recording
// failures. Surfaces the underlying DOMException name + message so the user
// (and bug reports) get something actionable instead of "didn't work".

interface NamedError {
  name?: string;
  message?: string;
}

const HINTS: Record<string, string> = {
  NotAllowedError: [
    'Windows がループバック共有を拒否しました。',
    '・設定 → プライバシーとセキュリティ → 画面記録 で otak-sampler を許可',
    '・最初の共有プロンプトでは「画面全体」を選んで承認',
    '・所属する組織のグループポリシーで画面共有が無効化されていないか確認'
  ].join('\n'),
  NotFoundError: [
    '画面ソース or システムオーディオトラックが取得できませんでした。',
    '・リモートデスクトップ / 仮想ディスプレイ環境では loopback 不可',
    '・HDMI 単独出力など、Windows 側の既定再生デバイスにオーディオが流れていないと失敗',
    '・サウンド設定で出力デバイスを一度切り替えて戻してください'
  ].join('\n'),
  AbortError:
    '共有プロンプトがキャンセルされたか OS 側で中断されました。もう一度試してください。',
  NotReadableError: [
    'OS がオーディオキャプチャを開始できませんでした。次の順で試してください:',
    '1. 他のスクリーン共有 / 録画アプリを終了 (OBS, Discord 画面共有, Teams, Zoom, NVIDIA ShadowPlay 等)',
    '2. otak-sampler を一度終了 → 起動し直し',
    '3. Windows のサウンド設定で出力デバイスを別物に切り替え → 元に戻す（ループバックストリームがリセットされます）',
    '4. それでもダメなら管理者 PowerShell で:  Restart-Service audiosrv',
    '5. オーディオドライバが古い場合は更新（Realtek, Conexant 等）'
  ].join('\n')
};

export function describeLoopbackError(err: unknown, action: '録音' | 'ループ録音' = '録音'): string {
  const e = err as NamedError;
  const name = e?.name ?? 'Error';
  const message = e?.message ?? String(err);
  const hint = HINTS[name];
  const lines = [`${action}を開始できませんでした。`, '', `${name}: ${message}`];
  if (hint) {
    lines.push('', hint);
  } else {
    lines.push(
      '',
      'Windows のプライバシー設定で「画面記録」が許可されているか確認してください。'
    );
  }
  return lines.join('\n');
}
