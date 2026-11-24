"""Run with python -I -B social/server/bothouse/test_friend_shares.py."""
from pathlib import Path
import runpy
import unittest

resolve = runpy.run_path(str(Path(__file__).with_name("instance.py")))["upstream_identity"]

class FriendSharesTest(unittest.TestCase):
    def test_exact_grant_and_independent_authority(self):
        actor = "arcade:river"
        access = {"configured": True, "arcade_friends": ["river"], "roles": {"member": {"user_ids": ["work-15"]}}}
        link = {"instance": "host", "identity": "work-15"}
        self.assertEqual(resolve(access, actor, {}, "host", "paper"), actor)
        self.assertIsNone(resolve(access, "arcade:river2", {}, "host", "paper"))
        self.assertEqual(resolve(access, actor, link, "host", "paper"), "work-15")
        del access["arcade_friends"]
        self.assertIsNone(resolve(access, actor, {}, "host", "paper"))
        self.assertEqual(resolve(access, actor, link, "host", "paper"), "work-15")
        self.assertIsNone(resolve(access, actor, link, "elsewhere", "paper"))

if __name__ == "__main__":
    unittest.main()
