import unittest
from kvm_capacity import quantity, eligible_nodes

class CapacityTest(unittest.TestCase):
    def test_canonical_quantities(self):
        for raw, expected in [("1k", 1000), ("1000", 1000), ("1e3", 1000), ("1Ki", 1024), ("0", 0), ("500m", 0.5), ("2M", 2000000)]:
            self.assertEqual(quantity(raw), expected)
    def test_invalid(self):
        for raw in ["", "1foo", "NaN", "1k2"]:
            with self.assertRaises(ValueError):
                quantity(raw)
    def test_eligible(self):
        def node(name, count, ready=True, schedulable=True):
            return {"metadata":{"name":name,"labels":{"kubevirt.io/schedulable":str(schedulable).lower()}},
                    "status":{"allocatable":{"devices.kubevirt.io/kvm":count},
                              "conditions":[{"type":"Ready","status":"True" if ready else "False"}]}}
        document={"items":[node("good","1k"),node("zero","0"),node("fraction","500m"),
                           node("not-ready","1k",False),node("unschedulable","1k",True,False)]}
        self.assertEqual([n["name"] for n in eligible_nodes(document)], ["good"])
        self.assertEqual(eligible_nodes({"items":[]}), [])
