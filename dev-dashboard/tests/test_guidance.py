import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from task_guidance import attention_for


class TaskGuidanceTests(unittest.TestCase):
    def test_legacy_implemented_but_unverified_is_not_completion(self):
        task = {'state':'blocked', 'error':'月面を4K化しました。', 'result':{
            'status':'blocked', 'summary':'月面を4K化しました。', 'checks':[
                '月面14件：成功、失敗0。',
                'npm test：終了1。Zig起動のEPERMで全テスト未実行。',
                'ブラウザー利用不可のため、WebGL実描画は未検証。']}}
        note = attention_for(task)
        self.assertEqual('blocked', task['state'])
        self.assertIn('権限制限', note['reason'])
        self.assertIn('npm test', note['steps'][0])
        self.assertTrue(any('目視確認' in step for step in note['steps']))
        self.assertEqual('inferred', note['source'])
        self.assertIn(task['result']['checks'][1], note['evidence'])
        self.assertNotIn(task['result']['checks'][0], note['evidence'])

    def test_worker_reports_exact_missing_input(self):
        task = {'state':'blocked', 'error':'実装の途中', 'result':{
            'status':'blocked', 'summary':'UI作成済み', 'checks':[],
            'blocker_reason':'表示単位の指定がありません。',
            'next_steps':['距離を km と m のどちらで表示するか指定してください。']}}
        note = attention_for(task)
        self.assertEqual(task['result']['blocker_reason'], note['reason'])
        self.assertEqual(task['result']['next_steps'], note['steps'])
        self.assertEqual('reported', note['source'])

    def test_completed_and_active_states_never_show_stale_attention(self):
        for state in ['done','review','running','queued','cancelled']:
            with self.subTest(state=state):
                self.assertIsNone(attention_for({'state':state,'error':'old EPERM','result':{'status':'blocked'}}))

    def test_sandbox_failure_is_distinct_from_test_permissions(self):
        note = attention_for({'state':'blocked','error':'Codex sandbox preflight failed','result':None})
        self.assertIn('起動', note['reason'])
        self.assertIn('manage.py doctor', note['steps'][0])
        self.assertNotIn('npm test', note['steps'][0])

    def test_unknown_failure_does_not_invent_a_cause(self):
        note = attention_for({'state':'blocked','error':'Unexpected exit 42','result':None})
        self.assertEqual('Unexpected exit 42', note['reason'])
        self.assertIn('ログ', note['steps'][0])

    def test_publication_error_does_not_look_like_success(self):
        note = attention_for({'state':'blocked','error':'push rejected','result':{'status':'ready','checks':['Tests passed']}})
        self.assertIn('成果の確定', note['reason'])
        self.assertTrue(any('push' in step for step in note['steps']))


if __name__ == '__main__':
    unittest.main()
