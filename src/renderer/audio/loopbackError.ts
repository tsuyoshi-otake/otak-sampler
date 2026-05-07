// Build a verbose, copy-pasteable error message for loopback recording
// failures. Surfaces the underlying DOMException name + message so the user
// (and bug reports) get something actionable instead of "didn't work".

interface NamedError {
  name?: string;
  message?: string;
}

const HINTS: Record<string, string> = {
  NotAllowedError:
    'Windows がループバック共有を拒否しました。設定 → プライバシーとセキュリティ → 画面記録 で otak-sampler を許可するか、最初の共有プロンプトを「画面全体」で承認してください。',
  NotFoundError:
    '画面ソースが見つかりませんでした。リモートデスクトップ越しや仮想ディスプレイ環境では loopback が使えないことがあります。',
  AbortError:
    '共有プロンプトがキャンセルされたか OS 側で中断されました。もう一度試してください。',
  NotReadableError:
    'オーディオデバイスが他アプリに占有されています。録音 / 配信ソフトを停止してから再試行してください。'
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
