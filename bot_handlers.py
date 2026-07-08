import re
import logging
from datetime import datetime, timedelta
import aiohttp
from aiogram import F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, PreCheckoutQuery, ContentType, LabeledPrice
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from config import bot, dp, supabase, ADMIN_IDS, CATEGORIES
from ad_utils import send_banner_ad
from gifts_data import GIFTS

# ==================== STATES FOR VIDEO UPLOAD ====================
class AdminUpload(StatesGroup):
    waiting_link = State()
    waiting_category = State()

class BrokenState(StatesGroup):
    waiting_cleanup = State()

# ==================== PAYMENT HANDLERS ====================

@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    """Required handler – answer within 10 seconds"""
    try:
        logging.info(f"📦 Pre-checkout query: id={pre_checkout_query.id}, user={pre_checkout_query.from_user.id}")
        await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)
    except Exception as e:
        logging.error(f"🔥 Failed to answer pre_checkout_query: {e}", exc_info=True)

@dp.message(F.content_type == ContentType.SUCCESSFUL_PAYMENT)
async def on_successful_payment(message: Message):
    """Handle successful payment – gifts or premium."""
    try:
        payment = message.successful_payment
        telegram_id = message.from_user.id
        payload = payment.invoice_payload
        now = datetime.utcnow()

        # --- Check if this is a GIFT payment ---
        if payload.startswith("gift_"):
            parts = payload.split("_")
            if len(parts) >= 3:
                gift_id = parts[1]
                buyer_id = int(parts[2])
                gift = next((g for g in GIFTS if g["id"] == gift_id), None)
                if not gift:
                    logging.error(f"Unknown gift_id in payload: {gift_id}")
                    await message.answer("❌ Gift not recognized. Please contact support.")
                    return

                gift_record = {
                    "user_id": buyer_id,
                    "gift_id": gift["id"],
                    "gift_name": gift["name"],
                    "gift_emoji": gift["emoji"],
                    "gift_price": gift["price"],
                    "created_at": now.isoformat()
                }
                supabase.table("gift_purchases").insert(gift_record).execute()
                logging.info(f"🎁 Gift purchase recorded: {gift['name']} for user {buyer_id}")

                if gift["category"] == "overpriced":
                    user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", buyer_id).execute()
                    new_expiry = now + timedelta(days=30)
                    if user_result.data and user_result.data[0].get("premium_expires_at"):
                        current_expiry_str = user_result.data[0]["premium_expires_at"]
                        try:
                            if current_expiry_str.endswith('Z'):
                                current_expiry_str = current_expiry_str.replace('Z', '+00:00')
                            current_expiry = datetime.fromisoformat(current_expiry_str)
                            if current_expiry.tzinfo:
                                current_expiry = current_expiry.replace(tzinfo=None)
                            if current_expiry > now and current_expiry > new_expiry:
                                new_expiry = current_expiry + timedelta(days=30)
                        except Exception:
                            pass
                    supabase.table("users").upsert({
                        "telegram_id": buyer_id,
                        "is_premium": True,
                        "premium_expires_at": new_expiry.isoformat(),
                        "updated_at": now.isoformat()
                    }).execute()
                    logging.info(f"✨ Granted 30-day premium to user {buyer_id} for overpriced gift")
                    await message.answer(
                        f"🎁 Thank you for the {gift['emoji']} {gift['name']}!\n"
                        f"✨ As a bonus, you've received <b>30 days of VidVids Premium</b>! ✨\n\n"
                        f"Refresh your mini app to enjoy ad-free experience.",
                        parse_mode="HTML"
                    )
                else:
                    await message.answer(
                        f"🎁 Thank you for sending {gift['emoji']} {gift['name']}!\n"
                        f"Your gift has been received!"
                    )
                return

        # --- Premium payment ---
        logging.info(f"💰 Successful premium payment from user {telegram_id}, amount={payment.total_amount} {payment.currency}")

        user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", telegram_id).execute()
        new_expiry = now + timedelta(days=30)
        if user_result.data:
            current_expiry_str = user_result.data[0].get("premium_expires_at")
            if current_expiry_str:
                try:
                    if current_expiry_str.endswith('Z'):
                        current_expiry_str = current_expiry_str.replace('Z', '+00:00')
                    current_expiry = datetime.fromisoformat(current_expiry_str)
                    if current_expiry.tzinfo:
                        current_expiry = current_expiry.replace(tzinfo=None)
                    if current_expiry > now:
                        new_expiry = current_expiry + timedelta(days=30)
                        logging.info(f"Extending premium for user {telegram_id} from {current_expiry} to {new_expiry}")
                except Exception as e:
                    logging.warning(f"Could not parse existing expiry, using 30 days from now: {e}")

        supabase.table("users").upsert({
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": new_expiry.isoformat(),
            "updated_at": now.isoformat()
        }).execute()

        payment_record = {
            "telegram_id": telegram_id,
            "provider": "telegram_stars",
            "amount": payment.total_amount,
            "currency": payment.currency,
            "payload": payment.invoice_payload,
            "transaction_id": payment.telegram_payment_charge_id,
            "status": "completed"
        }
        supabase.table("payments").insert(payment_record).execute()

        await message.answer(
            "🎉 Payment successful! You are now a VidVids Premium member!\n\n"
            f"✅ Your premium access is active until {new_expiry.strftime('%Y-%m-%d')}.\n"
            "✅ Ads have been removed from your experience.\n\n"
            "To refresh your premium status in the app:\n"
            "1. Close and reopen the VidVids Mini App\n"
            "2. Or tap 'Check Premium Status' button\n\n"
            "Use /premium anytime to check your status."
        )

        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Refresh Mini App", web_app={"url": "https://ojareridominion-prog.github.io/VidVids/"})],
            [InlineKeyboardButton(text="🚀 Open VidVids", web_app={"url": "https://ojareridominion-prog.github.io/VidVids/"})]
        ])
        await message.answer(
            "Click below to open the refreshed app with premium activated:",
            reply_markup=keyboard
        )

    except Exception as e:
        logging.error(f"🔥 Payment DB Error: {e}", exc_info=True)
        await message.answer(
            f"⚠️ Payment received, but there was an error activating premium. "
            f"Please contact support and provide your user ID: {message.from_user.id}"
        )

# ==================== BOT COMMANDS ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    telegram_id = message.from_user.id
    try:
        result = supabase.table("users").select("telegram_id").eq("telegram_id", telegram_id).execute()
        if not result.data:
            supabase.table("users").insert({
                "telegram_id": telegram_id,
                "is_premium": False,
                "created_at": datetime.utcnow().isoformat()
            }).execute()
            logging.info(f"👤 New user {telegram_id} created via /start")
    except Exception as e:
        logging.error(f"Error creating user on /start: {e}")

    await send_banner_ad(message.chat.id, telegram_id)

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Let's Go!", web_app={"url": "https://ojareridominion-prog.github.io/VidVids/"})],
        [InlineKeyboardButton(text="📢 Official Channel", url="https://t.me/VidVids_channel")]
    ])
    await message.answer(
        "VidVids isn't just an app—it's your personal portal to a world of endless, breathtaking videos.\n\n"
        "Don't wait, click let's go 🚀🚀 to continue",
        reply_markup=keyboard
    )

@dp.message(F.text == "/premium")
async def cmd_premium(message: Message):
    telegram_id = message.from_user.id
    logging.info(f"Checking premium for user ID: {telegram_id}")

    try:
        user_result = supabase.table("users") \
            .select("is_premium, premium_expires_at") \
            .eq("telegram_id", telegram_id) \
            .execute()

        if not user_result.data or len(user_result.data) == 0:
            supabase.table("users").insert({
                "telegram_id": telegram_id,
                "is_premium": False
            }).execute()
            user_data = {"is_premium": False, "premium_expires_at": None}
        else:
            user_data = user_result.data[0]

        is_premium = user_data.get("is_premium", False)
        premium_expires_at = user_data.get("premium_expires_at")

        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)

        if is_premium_bool and premium_expires_at:
            try:
                expires_at_str = premium_expires_at
                if expires_at_str.endswith('Z'):
                    expires_at_str = expires_at_str.replace('Z', '+00:00')
                expires_at = datetime.fromisoformat(expires_at_str)
                now = datetime.utcnow().replace(tzinfo=None)
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)
                if expires_at > now:
                    days_left = (expires_at - now).days
                    await message.answer(
                        f"✨ <b>Premium Status</b>\n\n"
                        f"✅ You are a <b>Premium Member</b>!\n"
                        f"⏳ Days remaining: <b>{days_left}</b> day(s)\n"
                        f"📅 Expires on: {expires_at.strftime('%Y-%m-%d')}\n\n"
                        f"Enjoy your ad-free experience! 🎉",
                        parse_mode="HTML"
                    )
                    return
            except Exception as e:
                logging.error(f"Date parsing error: {e}")

        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")],
            [InlineKeyboardButton(text="🚀 Open VidVids", web_app={"url": "https://ojareridominion-prog.github.io/VidVids/"})]
        ])
        await message.answer(
            "✨ <b>VidVids Premium</b>\n\n"
            "🔓 You are currently on the free plan.\n\n"
            "✨ <b>Upgrade to Premium for:</b>\n"
            "• 🚫 No ads\n"
            "• 😁 Support the project\n\n"
            "💫 <b>Price:</b> 99 Stars (30 days)\n\n"
            "Click 'Get Premium' to upgrade!",
            parse_mode="HTML",
            reply_markup=keyboard
        )
    except Exception as e:
        logging.error(f"Premium check error: {e}", exc_info=True)
        await message.answer("❌ There was an error checking your premium status.\n\nPlease try again in a few moments.")

    await send_banner_ad(message.chat.id, telegram_id)

@dp.callback_query(F.data == "get_premium")
async def get_premium_callback(call: CallbackQuery):
    await call.answer()
    invoice_link = await bot.create_invoice_link(
        title="VidVids Premium",
        description="30 days of ad-free experience",
        payload=f"premium_{call.from_user.id}",
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(label="Premium Access", amount=99)]
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Pay Now", url=invoice_link)],
        [InlineKeyboardButton(text="🔙 Back", callback_data="back_to_premium")]
    ])
    await call.message.edit_text(
        "✨ <b>Upgrade to VidVids Premium</b>\n\n"
        "💫 <b>Price:</b> 99 Stars (30 days)\n\n"
        "<b>Benefits:</b>\n"
        "• 🚫 No ads\n"
        "• 😁 Support the project\n\n"
        "Click 'Pay Now' to complete your purchase.",
        parse_mode="HTML",
        reply_markup=keyboard
    )
    await send_banner_ad(call.message.chat.id, call.from_user.id)

@dp.callback_query(F.data == "back_to_premium")
async def back_to_premium_callback(call: CallbackQuery):
    await call.answer()
    await cmd_premium(call.message)
    await send_banner_ad(call.message.chat.id, call.from_user.id)

@dp.callback_query(F.data == "renew_premium")
async def renew_premium_callback(call: CallbackQuery):
    await get_premium_callback(call)
    await send_banner_ad(call.message.chat.id, call.from_user.id)

@dp.message(F.text.startswith("/start premium"))
async def start_premium(message: Message):
    await cmd_premium(message)

# ==================== ADMIN COMMANDS ====================

def extract_youtube_id(url: str):
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11})(?:[?&]|$)",
        r"(?:embed\/)([0-9A-Za-z_-]{11})",
        r"(?:youtu\.be\/)([0-9A-Za-z_-]{11})"
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

async def is_youtube_video_accessible(url: str) -> bool:
    """Check if a YouTube video exists and is accessible (not deleted/private)."""
    try:
        oembed_url = f"https://www.youtube.com/oembed?url={url}&format=json"
        async with aiohttp.ClientSession() as session:
            async with session.get(oembed_url, timeout=5) as resp:
                return resp.status == 200
    except Exception:
        return False

@dp.message(F.from_user.id.in_(ADMIN_IDS), F.text == "/admin")
async def admin_cmd(message: Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload Video", callback_data="upload_video")],
        [InlineKeyboardButton(text="🔗 Check Broken Links", callback_data="check_broken")]
    ])
    await message.answer("<b>Admin Control Panel</b>\nChoose an action:", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "upload_video")
async def upload_video_start(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Please send the YouTube link (URL) of the video/short you want to add.")
    await state.set_state(AdminUpload.waiting_link)
    await call.answer()

@dp.message(AdminUpload.waiting_link, F.text)
async def process_youtube_link(message: Message, state: FSMContext):
    url = message.text.strip()
    video_id = extract_youtube_id(url)
    if not video_id:
        await message.answer("❌ Invalid YouTube link. Please send a correct YouTube video or short URL.")
        return

    accessible = await is_youtube_video_accessible(url)
    if not accessible:
        await message.answer("❌ Video not found or is private/deleted. Please check the link and try again.")
        return

    try:
        existing = supabase.table("media_content").select("url").eq("url", url).execute()
        if existing.data:
            await message.answer("❌ This video has already been uploaded (duplicate).")
            return
    except Exception as e:
        logging.error(f"Duplicate check error: {e}")
        await message.answer("⚠️ Database error. Please try again later.")
        return

    await state.update_data(video_url=url, video_id=video_id)

    # Build category buttons from CATEGORIES list (already updated in config)
    category_buttons = []
    for i in range(0, len(CATEGORIES), 2):
        row = [
            InlineKeyboardButton(text=cat, callback_data=f"setcat_{cat}")
            for cat in CATEGORIES[i:i+2]
        ]
        category_buttons.append(row)

    keyboard = InlineKeyboardMarkup(inline_keyboard=category_buttons)
    await message.answer("Select the category for this video:", reply_markup=keyboard)
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("setcat_"), AdminUpload.waiting_category)
async def set_video_category(call: CallbackQuery, state: FSMContext):
    category = call.data.split("_", 1)[1]
    user_data = await state.get_data()
    video_url = user_data.get("video_url")
    if not video_url:
        await call.message.edit_text("❌ Session expired. Please start over with /admin.")
        await state.clear()
        return

    try:
        supabase.table("media_content").insert({
            "url": video_url,
            "category": category,
        }).execute()
        await call.message.edit_text(f"✅ Video added successfully to category <b>{category}</b>!", parse_mode="HTML")
    except Exception as e:
        logging.error(f"Insert error: {e}")
        await call.message.edit_text("❌ Failed to save video to database. Check logs.")
    finally:
        await state.clear()
    await call.answer()

@dp.callback_query(F.data == "check_broken")
async def check_broken_links(call: CallbackQuery, state: FSMContext):
    await call.answer("Checking...")
    try:
        result = supabase.table("media_content").select("id, url").execute()
        records = result.data
        if not records:
            await call.message.edit_text("No videos found in the database.")
            return
    except Exception as e:
        logging.error(f"DB fetch error: {e}")
        await call.message.edit_text("❌ Failed to fetch videos.")
        return

    broken = []
    for rec in records:
        url = rec["url"]
        accessible = await is_youtube_video_accessible(url)
        if not accessible:
            broken.append(rec)

    if not broken:
        await call.message.edit_text("✅ All videos are accessible. No broken links found.")
        return

    broken_list_text = "\n".join([f"• {rec['url']}" for rec in broken[:10]])
    if len(broken) > 10:
        broken_list_text += f"\n... and {len(broken)-10} more."
    message_text = f"⚠️ Found {len(broken)} broken video(s):\n{broken_list_text}\n\nDo you want to delete all broken entries?"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🗑️ Cleanup All Broken", callback_data="cleanup_broken")],
        [InlineKeyboardButton(text="Cancel", callback_data="cancel_cleanup")]
    ])
    await state.set_state(BrokenState.waiting_cleanup)
    await state.update_data(broken_ids=[rec["id"] for rec in broken])
    await call.message.edit_text(message_text, reply_markup=keyboard)
    await call.answer()

@dp.callback_query(F.data == "cleanup_broken")
async def cleanup_broken_links(call: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    broken_ids = data.get("broken_ids", [])
    if not broken_ids:
        await call.message.edit_text("No broken entries to delete.")
        await state.clear()
        return

    try:
        for rid in broken_ids:
            supabase.table("media_content").delete().eq("id", rid).execute()
        await call.message.edit_text(f"✅ Deleted {len(broken_ids)} broken video(s).")
    except Exception as e:
        logging.error(f"Cleanup error: {e}")
        await call.message.edit_text("❌ Failed to delete some entries. Check logs.")
    finally:
        await state.clear()
    await call.answer()

@dp.callback_query(F.data == "cancel_cleanup")
async def cancel_cleanup(call: CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.edit_text("Cleanup cancelled.")
    await call.answer()
    
