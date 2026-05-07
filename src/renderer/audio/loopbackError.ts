// Build a verbose, copy-pasteable error message for recording failures
// (loopback OR microphone). Surfaces the underlying DOMException name +
// message so the user (and bug reports) get something actionable instead
// of a vague "didn't work".

import type { RecordingSource } from '../../shared/settings-schema';

interface NamedError {
  name?: string;
  message?: string;
}

const LOOPBACK_HINTS: Record<string, string> = {
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

const MIC_HINTS: Record<string, string> = {
  NotAllowedError: [
    'マイクへのアクセスが拒否されました。',
    '・設定 → プライバシーとセキュリティ → マイク で otak-sampler を許可',
    '・「アプリがマイクにアクセスできるようにする」が ON か確認',
    '・最初の許可プロンプトを誤って「ブロック」した場合、本体再起動で再試行'
  ].join('\n'),
  NotFoundError: [
    'マイクデバイスが見つかりませんでした。',
    '・Windows のサウンド設定で入力デバイスが認識されているか確認',
    '・USB マイクは別ポートに差し替え',
    '・既定の入力デバイスが正しく設定されているか確認'
  ].join('\n'),
  AbortError: 'マイク権限プロンプトがキャンセルされました。もう一度試してください。',
  NotReadableError: [
    'マイクが他アプリに占有されています。',
    '・通話アプリ (Zoom / Teams / Discord) や録音ソフトを終了',
    '・otak-sampler を再起動',
    '・Windows のサウンド設定で「アプリの排他モード」を無効化'
  ].join('\n'),
  OverconstrainedError:
    'マイクの制約条件が満たせませんでした。サンプルレートやチャンネル設定を確認してください。'
};

export function describeLoopbackError(
  err: unknown,
  action: '録音' | 'ループ録音' = '録音',
  source: RecordingSource = 'loopback'
): string {
  const e = err as NamedError;
  const name = e?.name ?? 'Error';
  const message = e?.message ?? String(err);
  const hints = source === 'mic' ? MIC_HINTS : LOOPBACK_HINTS;
  const hint = hints[name];
  const lines = [`${action}を開始できませんでした。`, '', `${name}: ${message}`];
  if (hint) {
    lines.push('', hint);
  } else if (source === 'mic') {
    lines.push('', 'Windows のプライバシー設定で「マイク」が許可されているか確認してください。');
  } else {
    lines.push(
      '',
      'Windows のプライバシー設定で「画面記録」が許可されているか確認してください。'
    );
  }
  return lines.join('\n');
}
