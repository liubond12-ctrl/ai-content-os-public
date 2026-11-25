import { NextResponse } from "next/server";

import { assembleContext, taskInputSchema } from "@/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = taskInputSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "任务输入未通过验证。",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }
    const result = await assembleContext(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "上下文装配失败。",
        detail: error instanceof Error ? error.message : "未知错误",
      },
      { status: 500 },
    );
  }
}
