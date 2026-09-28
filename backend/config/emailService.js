import nodemailer from "nodemailer";
import dotenv from "dotenv";
import logger from "./logger.js";
dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendOtpEmail(to, otp) {
  const mailOptions = {
    from: `"GameSocial" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Your GameSocial code",
    text: `Your GameSocial code is ${otp}. It expires in 5 minutes.\n\nIf you didn't ask for it, you can ignore this email.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info("OTP email sent to: %s", to);
  } catch (err) {
    logger.error({ err }, "Failed to send OTP email");
    throw new Error("Email sending failed");
  }
}
export default transporter;