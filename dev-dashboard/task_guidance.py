"""Explain blocked tasks without changing their execution/completion state."""
import re


def attention_for(task):
    if task['state'] != 'blocked':
        return None
    result = task.get('result') or {}
    error = task.get('error') or ''
    checks = result.get('checks') or []
    evidence = [check for check in checks if any(word in re.sub(r'失敗[：: ]*0(?:件)?', '', check.lower()) for word in
                ('eperm', '失敗', '未実行', '未検証', '不可', '終了1', 'failed', 'denied', 'not permitted'))]

    def guidance(reason, steps, source='system'):
        return {'reason': reason, 'steps': steps, 'evidence': evidence, 'source': source}

    if 'sandbox preflight failed' in error or 'bwrap:' in error:
        return guidance('実行用サンドボックスを起動できません。', [
            '端末で python3 dev-dashboard/manage.py doctor を実行し、表示された環境エラーを解消してください。',
            '診断が成功したら「対応後に再試行」を押してください。キューが一時停止中なら再開してください。'])
    if 'Service restarted' in error:
        return guidance('サービス再起動で作業が中断しました。', [
            'このタスクの作業場所に保持された変更を確認し、「対応後に再試行」を押してください。'])
    if 'time limit' in error or 'Worker stopped' in error:
        return guidance('作業が制限時間に達したか、サービス停止で中断しました。', [
            'ログ末尾で停止した処理を確認してください。必要に応じて作業を分割するか、設定の制限時間を調整してください。',
            '保持された変更を確認して「対応後に再試行」を押してください。'])
    if result.get('status') == 'ready' and error:
        return guidance('検証結果は返りましたが、成果の確定処理で停止しました。', [
            '下のエラー詳細で、ブランチ・コミット・push または結果形式の問題を確認して解消してください。',
            '「対応後に再試行」で成果の確定をやり直してください。main への統合はまだ行わないでください。'])
    # New workers explicitly separate achievements from blockers and user actions.
    if result.get('blocker_reason') and result.get('next_steps'):
        return guidance(result['blocker_reason'], result['next_steps'], 'reported')

    # Older reports have only summary/checks. Infer guidance from failure evidence,
    # never from words such as "implemented" or "completed" in the summary.
    text = '\n'.join([error, *checks]).lower()
    steps = []
    permission = any(word in text for word in ('eperm', 'permission denied', 'operation not permitted', '権限エラー'))
    visual = any(word in text for word in ('未検証', '未実行', '不可', 'できず', 'できません')) and any(word in text for word in ('webgl', 'ブラウザ', 'ブラウザー', '実画面', 'gpu'))
    if permission:
        reason = '実行環境の権限制限により、必要なビルド・全体テストを完了できていません。'
        steps.append('通常の端末で、このタスクの作業場所へ移動し、npm test を実行して Zig 起動・通信権限のエラーが解消するか確認してください。' if 'npm test' in text else '通常の端末で、このタスクの作業場所へ移動し、検証結果に記載された失敗コマンドを再実行してください。')
    elif evidence:
        reason = '必要な検証に失敗、または未実施の項目があります。'
        steps.append('下の「未完了の検証」を確認し、このタスクの作業場所で失敗箇所を修正・再検証してください。')
    else:
        reason = error or '実行を続けるための確認が必要です。'
        steps.append('ログ末尾とエラー詳細を確認してください。原因や必要な対応が不明なら、タスク ID とログを Codex に渡して調査を依頼してください。')
    if visual:
        steps.append('ブラウザーが使える環境で対象画面を開き、表示を目視確認してください。今回の結果では実描画を確認できていません。')
    if permission or evidence:
        steps.append('原因を解消して「対応後に再試行」を押してください。変更は保持されます。同じ権限制限が残ると再び停止します。')
    return guidance(reason, steps, 'inferred')
