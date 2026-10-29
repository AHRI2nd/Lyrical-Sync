import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch


ALIGN_PATH = pathlib.Path(__file__).parents[1] / "src-tauri" / "src" / "align.py"
SPEC = importlib.util.spec_from_file_location("lyrical_align", ALIGN_PATH)
ALIGN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ALIGN)


class AlignmentStdinTests(unittest.TestCase):
    def test_long_lyrics_are_read_from_stdin_without_argv_sized_payload(self):
        expected = [{"index": 0, "text": "a" * 40000}]
        payload = json.dumps(expected)
        self.assertGreater(len(payload), 32767)
        with patch("sys.stdin", io.StringIO(payload)):
            self.assertEqual(ALIGN.read_lines_input(None, True), expected)

    def test_legacy_inline_json_remains_supported(self):
        expected = [{"index": 1, "text": "hello"}]
        self.assertEqual(ALIGN.read_lines_input(json.dumps(expected), False), expected)


if __name__ == "__main__":
    unittest.main()
