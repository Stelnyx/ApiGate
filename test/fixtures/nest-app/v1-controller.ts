import { Controller, Get, Post, UseGuards } from "@nestjs/common";

@Controller({ path: "auth", version: "1" })
@UseGuards(JwtAuthGuard)
export class AuthV1Controller {
  @Get("me")
  me() { return null; }

  @Post("login")
  login() { return null; }
}

@Controller(["v2/items", "v3/items"])
export class ItemsArrayController {
  @Get(":id")
  findOne() { return null; }
}
