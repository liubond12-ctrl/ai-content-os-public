import { NextResponse } from "next/server";

import { compareContexts, comparisonSchema } from "@/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = comparisonSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "对比任务输入未通过验证。",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await compareContexts(parsed.data.left, parsed.data.right),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "上下文对比失败。",
        detail: error instanceof Error ? error.message : "未知错误",
      },
      { status: 500 },
    );
  }
}
