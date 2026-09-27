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
        steps.append('「対応後に再試行」を押すと、Approve for me で必要な権限を自動審査して検証を再開します。自動審査で停止する場合は「承認を自分で確認して再試行」を選び、表示された実行内容を確認して承認してください。')
    elif evidence:
        reason = '必要な検証に失敗、または未実施の項目があります。'
        steps.append('下の「未完了の検証」を確認し、このタスクの作業場所で失敗箇所を修正・再検証してください。')
    else:
        reason = error or '実行を続けるための確認が必要です。'
        steps.append('ログ末尾とエラー詳細を確認してください。原因や必要な対応が不明なら、タスク ID とログを Codex に渡して調査を依頼してください。')
    if visual:
        steps.append('再試行時はブラウザーでの描画検証も必要です。ブラウザー環境自体が利用できない場合は、その不足を結果に表示します。今回の結果では実描画を確認できていません。')
    if permission or evidence:
        steps.append('再試行でも変更は保持されます。未完了の検証が成功すると開発完了になります。')
    return guidance(reason, steps, 'inferred')
