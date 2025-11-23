import fs from "fs";
import path from "path";

export function loadTemplate(templateName: string) {
  const filePath = path.join(process.cwd(), "templates", templateName);
  return fs.readFileSync(filePath, "utf8");
}


