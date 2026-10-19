import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import app


def test_fake_report_genuine_without_screenshot():
    result = app.evaluate_fake_report(
        title="Minor UI issue",
        desc="Button alignment is off on the settings page.",
        severity="Low",
        screenshot_path=None
    )

    assert result["status"] == "Likely Genuine"
    assert result["score"] == 0
    assert result["reasons"] == []


def test_fake_report_suspicious_mismatch_and_inconsistent(monkeypatch):
    monkeypatch.setattr(app, "_extract_ocr_text", lambda _: "Login screen admin panel")
    monkeypatch.setattr(app, "_text_similarity", lambda _a, _b: 0.1)
    monkeypatch.setattr(app, "_compute_ela_score", lambda _: 0.0)
    monkeypatch.setattr(app, "_severity_inconsistent", lambda *_args, **_kwargs: True)

    result = app.evaluate_fake_report(
        title="Critical RCE",
        desc="No code execution observed, just a 500 error.",
        severity="Critical",
        screenshot_path="/tmp/fake.png"
    )

    assert result["status"] == "Suspicious"
    assert result["score"] == 60
    assert "Screenshot text does not match description" in result["reasons"]
    assert "Severity claim inconsistent with evidence" in result["reasons"]


def test_fake_report_likely_fake_with_ela_and_mismatch(monkeypatch):
    monkeypatch.setattr(app, "_extract_ocr_text", lambda _: "Unrelated content")
    monkeypatch.setattr(app, "_text_similarity", lambda _a, _b: 0.05)
    monkeypatch.setattr(app, "_compute_ela_score", lambda _: 0.35)
    monkeypatch.setattr(app, "_severity_inconsistent", lambda *_args, **_kwargs: False)

    result = app.evaluate_fake_report(
        title="Bug report",
        desc="Claims SQL injection in search endpoint.",
        severity="High",
        screenshot_path="/tmp/fake2.png"
    )

    assert result["status"] == "Likely Fake"
    assert result["score"] == 70
    assert "Screenshot text does not match description" in result["reasons"]
    assert "Screenshot shows signs of manipulation" in result["reasons"]


class _StandaloneMonkeyPatch:
    def __init__(self):
        self._restores = []

    def setattr(self, target, name, value):
        old = getattr(target, name, None)
        self._restores.append((target, name, old))
        setattr(target, name, value)

    def undo(self):
        for target, name, old in reversed(self._restores):
            if old is None:
                delattr(target, name)
            else:
                setattr(target, name, old)
        self._restores.clear()


if __name__ == "__main__":
    mp = _StandaloneMonkeyPatch()
    try:
        test_fake_report_genuine_without_screenshot()
        test_fake_report_suspicious_mismatch_and_inconsistent(mp)
        mp.undo()
        test_fake_report_likely_fake_with_ela_and_mismatch(mp)
        mp.undo()
        print("OK: 3 fake report detection tests passed.")
    except Exception as e:
        mp.undo()
        raise e
