"""Everything GENERAL. Proves the submit pipe works before any logic exists."""
import sys

from sdoc.inbox import load_emails
from sdoc.models import EmailResult
from sdoc.submit import build_submission, post_submission, write_submission

results = [EmailResult(email_id=e["email_id"], category="GENERAL") for e in load_emails()]
submission = build_submission(results)
write_submission(submission)
print(f"built {len(submission)} entries")

if len(sys.argv) > 1:
    print(post_submission(submission, sys.argv[1]))
