import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ordersRouter from "./orders";
import orderItemsRouter from "./order-items";
import ridersRouter from "./riders";
import restaurantsRouter from "./restaurants";
import usersRouter from "./users";
import settingsRouter from "./settings";
import pushRouter from "./push";
import tripsRouter from "./trips";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ordersRouter);
router.use(orderItemsRouter);
router.use(ridersRouter);
router.use(restaurantsRouter);
router.use(usersRouter);
router.use(settingsRouter);
router.use(pushRouter);
router.use(tripsRouter);

export default router;
