import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
    }

    // Proxy the upload to file.io from the server to bypass CORS
    const externalFormData = new FormData();
    externalFormData.append("file", file);

    const response = await fetch("https://file.io/?expires=1h", {
      method: "POST",
      body: externalFormData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return NextResponse.json({ 
        success: false, 
        error: data.message || "External upload failed" 
      }, { status: response.status });
    }

    return NextResponse.json({ 
      success: true, 
      link: data.link 
    });
  } catch (error) {
    console.error("Upload proxy error:", error);
    return NextResponse.json({ 
      success: false, 
      error: "Internal server error during upload" 
    }, { status: 500 });
  }
}
