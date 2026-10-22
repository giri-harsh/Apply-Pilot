import { describe, expect, it } from "vitest";
import { inflationViolations } from "@/resume/tailor/rules";

const SRC = "Built a churn prediction model using Python for the retention team Python";
const rules = (t: string) => inflationViolations(t, SRC).map((v) => v.rule);

describe("rules the Phase 6 validator lacks: invented seniority, outcomes and names (verifier finding 4)", () => {
  it.each([
    ["Led the retention team and built a churn prediction model using Python", "role_inflation"],
    ["Architected and owned a churn prediction model using Python, serving the whole company", "role_inflation"],
    ["Managed a churn prediction model built using Python for the retention team", "role_inflation"],
    ["Built a churn prediction model using Python, improving retention substantially", "unsupported_outcome"],
    ["Built a churn prediction model using Python and Kubeflow for the retention team", "unsupported_name"],
    ["Built a churn prediction model using Python for the Retention Team at Initech", "unsupported_name"],
  ])("rejects %s", (text, rule) => {
    expect(rules(text)).toContain(rule);
  });

  it.each([
    "Developed a churn prediction model in Python for the retention team",
    "Built a Python churn prediction model for the retention team",
    "Built a churn prediction model using Python for the retention team.",
  ])("accepts a faithful reword: %s", (text) => {
    expect(rules(text)).toEqual([]);
  });

  it("swapping one outcome verb for a synonym is the same claim; adding an outcome to a source with none is not", () => {
    expect(inflationViolations("Cut weekly reporting time by 4 hours", "Reduced weekly reporting time by 4 hours")).toEqual([]);
    expect(inflationViolations("Reduced weekly reporting time", "Wrote weekly reports").map((v) => v.rule)).toContain("unsupported_outcome");
  });
});
