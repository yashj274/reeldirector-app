import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh', name: 'Chinese', native: '中文' },
];

const STRINGS: Record<string, Record<string, string>> = {
  en: {
    welcome_back: 'Welcome back', new_reel: 'New Reel', dashboard: 'Home',
    projects: 'Projects', templates: 'Templates', profile: 'Profile',
    start_shooting: 'Start shooting', continue_shooting: 'Continue shooting',
    prepare_scenes: 'Preparing all scenes…',
    ai_scan: 'AI scan environment', edit_export: 'Edit video & export',
    render_final: 'Render final reel', reel_ready: 'Your reel is ready!',
    share_reel: 'Share reel',
    choose_language: 'Choose your language', language_subtitle: 'You can change it anytime in Settings.',
    continue: 'Continue', signin_subtitle: 'Sign in to keep directing.', email: 'Email', password: 'Password',
    forgot_password: 'Forgot password?', sign_in: 'Sign in', new_here: 'New here?', create_account: 'Create an account',
    create_account_title: 'Create account', signup_subtitle: 'Your first reel is 60 seconds away.', full_name: 'Full name',
    have_account: 'Have an account?', send_reset_link: 'Send reset link', reset_password: 'Reset password',
    new_password: 'New password', update_password: 'Update password', give_reel_name: 'Give it a name',
    type_of_shoot: 'Type of shoot', mood: 'Mood', duration: 'Duration', platform: 'Platform',
    purpose_label: 'What is it for?', purpose_hint: 'Describe what the video should show and why you are making it.',
    purpose_placeholder: 'Describe your project and we’ll shape the perfect reel for it…',
    purpose_required: 'Add a little more detail so the AI can plan your story (at least 10 characters).',
    target_audience: 'Target audience (optional)', create_project: 'Create project',
    custom_script: 'Your custom script', scene_scan_label: 'AI environment scan', storyboard: 'Storyboard',
    no_purpose: 'No purpose set', generate_storyboard: 'Generate AI storyboard',
    directing_your_shoot: 'Directing your shoot…', preview_final_reel: 'Preview final reel',
    reshoot: 'Reshoot', edit_video_export: 'Edit video & export',
    scan_fallback: 'Automatic scan was unavailable; the script uses your description.',
    clip_filter: 'Clip filter', overall_look: 'Overall look', title_text: 'Title text', sound_mix: 'Sound mix',
    export_format: 'Export format', save_edit: 'Save edit', edits_saved: 'Edits saved', render_upload_ready: 'Render upload-ready video',
    editor_title: 'Video editor', editor_heading: 'Shape your final video',
    editor_subheading: 'Arrange and trim clips, choose a look, add a title, and balance your audio.',
    clip_order_trims: 'Clip order & trims', clip_order_help: 'Use the arrows to reorder. Trim the in and out points in half-second steps.',
    ai_clip: 'AI clip', recorded_clip: 'Recorded clip', preview_opening_title: 'Preview · opening title and clip filter',
    preview_selected_filter: 'Preview · selected clip filter', included_final: 'Included in final video', skipped_final: 'Skipped in final video',
    overall_grade: 'Apply a finishing grade to the whole video.',
    title_overlay_help: 'Add a readable title overlay to the opening of your video.',
    sound_mix_help: 'Adjust the soundtrack against audio captured with your clips.',
    export_help: 'Choose a format that matches where you’ll upload.', record_clip_to_edit: 'Record or upload at least one clip to start editing.',
    type_title: 'Type your title', font: 'Font', placement_size_color: 'Placement · size · color',
    original_clip_audio: 'Original clip audio', soundtrack: 'Soundtrack', add_soundtrack: 'Add a soundtrack',
    frame_clips: 'Frame the clips', fill_frame: 'Fill frame', fit_whole_clip: 'Fit whole clip', resolution: 'Resolution',
    frame_rate: 'Frame rate', clips_in_edit: 'Clips in edit', estimated_length: 'Estimated length', export_size: 'Export size',
    rendering_video: 'Rendering your video…', saving: 'Saving…',
    reel_name_example: 'Example: Sunset rooftop', audience_example: 'Example: families, students, food lovers', custom: 'Custom',
    move_static: 'Hold still', move_pan_left: 'Pan left', move_pan_right: 'Pan right', move_tilt_up: 'Tilt up',
    move_tilt_down: 'Tilt down', move_dolly_in: 'Move closer', move_dolly_out: 'Step back',
    move_tracking: 'Follow the subject', move_orbit: 'Circle the subject', move_reveal: 'Slide aside to reveal', move_handheld: 'Move gently',
    title_required_error: 'Give your reel a name first.', email_reset_copy: 'Enter your account email and we’ll send you a secure reset link.',
    choose_password_copy: 'Choose a new password for your account.', password_reset_expired: 'This password reset link has expired. Request a new one.',
    password_min_error: 'Use at least 8 characters for your password.', password_mismatch: 'The passwords do not match.',
    reset_email_required: 'Enter the email address for your account.', reset_email_sent: 'If an account uses that email, a password reset link is on its way.',
    password_changed: 'Your password has been changed. You can now sign in.',
    rating_unavailable: 'Automatic shot rating is unavailable right now. Your clip is saved for review.',
    rating_pending: 'AI is rating this shot…', saving_clip: 'Saving your clip…',
    dashboard_hello: 'Hey {name}', ready_magic: 'Ready to make magic?', start_new_reel: 'Start a new reel',
    ai_plans_directs_edits: 'AI plans, directs, and edits for you.', cinematic_templates: 'Cinematic Templates',
    recent_projects: 'Recent projects', see_all: 'See all', first_masterpiece: 'Your first masterpiece is one tap away.',
    try_again: 'Try again', sign_in_again: 'Sign in again', no_projects: 'No projects yet. Tap + to create one.',
    preferences: 'Preferences', account: 'Account', support: 'Support', language: 'Language', editing_style: 'Editing style',
    creator_skill_level: 'How much filming experience do you have?', skill_help: 'You can change this anytime. Beginner is the default.',
    my_creator_style: 'My creator style', creator_style_help: 'Your choices and recent reels help personalize new shot plans.',
    preferred_duration: 'Usual reel length', reset_style_profile: 'Reset style profile', reset_style_confirm: 'Clear learned choices and return to the default style?', reset: 'Reset',
    creator_style_learned: 'Learned from {count} reels: {category}, {goal}, {pacing} pace, {text} on-screen text. Familiar moves: {movements}.',
    creator_style_empty: 'Your style will learn from reels you create. You can set a look and length now.', not_enough_data: 'still learning',
    create_in_my_style: 'Create in My Style', create_in_my_style_help: 'Use your saved look and choices for this reel.',
    more_options: 'More options', fewer_options: 'Fewer options',
    style_cinematic: 'Cinematic', style_fast_pace: 'Fast paced', style_minimal: 'Clean', style_editorial: 'Editorial', style_luxury: 'Luxury', style_action: 'Action',
    goal_storytelling: 'storytelling', goal_showcase: 'showcase', goal_sales: 'sales', goal_education: 'education',
    goal_entertainment: 'entertainment', goal_memory: 'memories', goal_brand_awareness: 'brand building',
    pacing_relaxed: 'relaxed', pacing_balanced: 'balanced', pacing_fast: 'fast',
    text_amount_minimal: 'minimal', text_amount_some: 'some', text_amount_more: 'more',
    beginner: 'Beginner', creator: 'Creator', pro: 'Pro',
    phase_hook: 'Hook', phase_detail: 'Detail', phase_action: 'Action', phase_hero: 'Hero', phase_cta: 'Ending',
    shot_current: 'Current', shot_done: 'Done', shot_upcoming: 'Upcoming', shot_retake: 'Retake', shot_skipped: 'Skipped', shot_plan: 'Shot plan',
    skip_shot: 'Skip this shot', include_shot: 'Include this shot',
    storyboard_preserved: 'AI could not update the plan. Your saved storyboard and clips are unchanged.',
    all_shots_skipped: 'All shots are skipped. Include one to start filming.',
    subscription: 'Subscription', downloads: 'Downloads', notifications: 'Notifications', help_faq: 'Help & FAQ',
    send_feedback: 'Send Feedback', privacy: 'Privacy', log_out: 'Log out', home: 'Home', all_projects: 'Projects',
    project_status_draft: 'Draft', project_status_storyboarded: 'Script ready', project_status_shooting: 'In progress',
    project_status_exported: 'Exported', edit_this_video: 'Edit this video',
    delete_project: 'Delete project', delete_project_confirm: 'Delete “{title}”? Its clips, soundtrack, and exports will also be deleted.',
    delete_project_action: 'Delete', delete_project_failed: 'Could not delete this project. Please try again.',
    edit_video_features: 'Trim clips · filters · text & fonts · sound', duration_label: 'Duration', aspect_label: 'Aspect',
    size_label: 'Size', style_label: 'Style', music_label: 'Music', captions_label: 'Captions', render_label: 'Render',
    none: 'None', on: 'On', off: 'Off', content: 'Content', download: 'Download', saved_to_cloud: 'Saved to cloud',
    save_project: 'Save project', change_regenerate: 'Change & Regenerate', change_music: 'Change music', change_style: 'Change style',
    regenerate: 'Regenerate', edit_again: 'Edit again', export_for: 'Export for', more_formats: 'More formats',
    play: 'Play', pause: 'Pause', full: 'Full', share: 'Share', export_other_format: 'Export in another format',
    loading_reel: 'Loading your reel…', could_not_open_reel: 'Could not open this reel',
    project_unavailable: 'The project is unavailable.', go_back: 'Go back', video_saved: 'Video saved',
    reel_saved_library: 'Your finished reel is in your photo library.', save_video_failed: 'Could not save video',
    allow_library_save: 'Allow photo-library access to save the video.',
    camera_mic_title: 'Camera and microphone access needed',
    camera_https_copy: 'This local link cannot open a live camera. Use the button below to record with your phone camera or choose a saved clip.',
    camera_permission_copy: 'Allow both so ReelDirector can show shot guidance and record video with sound.',
    phone_camera_clip_ready: 'Phone camera clip ready', record_or_choose_video: 'Record or choose a video',
    open_live_camera: 'Open live camera', live_camera: 'Live camera preview', checking_clip_frame: 'Checking a frame from your clip…',
    shot_counter: 'SHOT {current}/{total}', shot_saved_counter: 'Shot {current} of {total} saved',
    next_shot_counter: 'Next shot · {current} of {total}', video_mode: 'Video', stabilized_mode: 'Stabilized',
    grid: 'Grid', flip_camera: 'Flip camera',
    edit_filters_text_trim: 'Edit filters, text & trim', confirm_new_password: 'Confirm new password',
    request_another_link: 'Request another link', could_not_update_password: 'Could not update your password. Please try again.',
    use_your_audio: 'Use your own audio', current_music_mix: 'Your music will be mixed with the sound recorded by the camera.',
    import_audio_mix: 'Import an audio file to mix it with your recorded clips.', pause_preview: 'Pause preview', preview: 'Preview',
    remove: 'Remove', choose_different_audio: 'Choose a different audio file', choose_audio_file: 'Choose audio file',
    audio_file_note: 'Supports common audio files up to 25 MB. Camera audio remains in the final video.', apply_render_video: 'Apply & render video',
    custom_shoot_type: 'Custom shoot type', custom_shoot_help: 'AI will adapt the storyboard to your idea.',
    custom_shoot_example: 'Example: Birthday Party, Bike Ride, College Fest', cancel: 'Cancel', add: 'Add',
    shoot_type_wedding: 'Wedding', shoot_type_travel: 'Travel', shoot_type_food: 'Food', shoot_type_fashion: 'Fashion',
    shoot_type_gym: 'Gym', shoot_type_product: 'Product', shoot_type_real_estate: 'Real estate', shoot_type_cafe: 'Cafe',
    shoot_type_restaurant: 'Restaurant', shoot_type_event: 'Event', shoot_type_documentary: 'Documentary',
    shoot_type_business: 'Business', shoot_type_lifestyle: 'Lifestyle', shoot_type_daily_vlog: 'Daily vlog',
    shoot_type_social_media: 'Social media', shoot_type_cinematic: 'Cinematic', shoot_type_other: 'Other', mood_cinematic: 'Cinematic',
    mood_emotional: 'Emotional', mood_energetic: 'Energetic', mood_luxury: 'Luxury', mood_minimal: 'Minimal', mood_warm: 'Warm',
    template_wedding: 'Wedding Cinema', template_travel: 'Travel Vlog', template_food: 'Food Cinematic',
    template_fashion: 'Fashion Editorial', template_gym: 'Gym Motivation', template_real_estate: 'Real Estate',
    template_product: 'Product Showcase', template_viral: 'Viral Reel',
    template_mood_wedding: 'Emotional • Romantic', template_mood_travel: 'Adventure • Wide',
    template_mood_food: 'Warm • Macro', template_mood_fashion: 'Bold • Editorial',
    template_mood_gym: 'High Energy', template_mood_real_estate: 'Luxury • Spacious',
    template_mood_product: 'Clean • Premium', template_mood_viral: 'Fast • Bold',
    customize_storyboard: 'Customize storyboard', save: 'Save', description_label: 'Description', add_scene: 'Add scene',
    regenerate_scene: 'Regenerate scene', optional_ai_notes: 'Optional notes to steer the AI.',
    regen_notes_example: 'Example: more dramatic, add golden hour light', new_shot: 'New Shot',
    describe_shot: 'Describe this shot', hold_camera_steady: 'Hold camera steady',
    shot_size_extreme_wide: 'Extreme wide', shot_size_wide: 'Wide', shot_size_medium: 'Medium',
    shot_size_close_up: 'Close-up', shot_size_extreme_close_up: 'Extreme close-up',
    template_subtitle: 'Pick a look. AI handles the rest.',
    environment_scan: 'AI environment scan', scan_explainer: 'Scan the place you will film. The AI will use the scene and your description to write a custom shot plan.',
    camera_access_needed: 'Camera access needed', scan_permission: 'Allow camera access to scan the filming environment.', starting_camera: 'Starting camera…',
    grant_access: 'Grant access', scan_scene: 'Scan scene', scan_start: 'Start scan', scan_stop: 'Stop scan & analyze',
    scan_capture_hint: 'Slowly pan to show the space; two views are enough.', scan_views_captured: '{count} views captured',
    analyzing_scene: 'Analyzing scene…', scene_analyzed: 'Scene analyzed',
    lighting: 'Lighting', composition: 'Composition', suggested_shots: 'Suggested shots', scan_again: 'Scan again',
    generate_script: 'Use scan & write my script', skip_scan: 'Continue without a scan',
    generating_story: 'Writing your custom story…', move_guide: 'Movement guide', flashlight: 'Flashlight', brightness: 'Brightness',
    zoom: 'Zoom', zoom_unavailable: 'This camera cannot change zoom right now.', brightness_up: 'Increase brightness', brightness_down: 'Decrease brightness',
    blur: 'Blur', exposure: 'Exposure', framing: 'Framing', stability: 'Stability', clip_saved: 'Clip saved',
    great_shot: 'Great shot!', retake_suggested: 'Retake suggested', retake_required: 'Retake required',
    your_shot: 'Your shot · watch it back', retake: 'Retake', next_shot: 'Next shot', finish_edit: 'Finish & edit',
    camera_movement_unavailable: 'This browser cannot control the flashlight on this device.',
    translation_loading: 'Preparing your language…', translation_failed: 'Some labels may remain in English while offline.',
    local_recovery_pending: 'Your latest changes are saved on this device and will sync when you are back online.',
    local_recovery_offline: 'Showing the copy saved on this device. Reconnect to refresh your project and clips.',
    local_recovery_conflict: 'This project changed on another device. Your latest changes are safe on this device but need help to sync.',
    project_load_failed: 'Could not open this project. Check your connection and try again.',
    sync_try_again: 'Try again',
  },
  hi: {
    welcome_back: 'वापस स्वागत है', new_reel: 'नया रील', dashboard: 'होम',
    projects: 'प्रोजेक्ट्स', templates: 'टेम्पलेट्स', profile: 'प्रोफ़ाइल',
    start_shooting: 'शूटिंग शुरू करें', continue_shooting: 'शूटिंग जारी रखें', prepare_scenes: 'सभी दृश्य तैयार हो रहे हैं…',
    ai_scan: 'एआई दृश्य स्कैन', edit_export: 'वीडियो एडिट और एक्सपोर्ट',
    render_final: 'अंतिम रील रेंडर करें', reel_ready: 'आपकी रील तैयार है!',
    share_reel: 'रील साझा करें',
    choose_language: 'अपनी भाषा चुनें', language_subtitle: 'आप इसे सेटिंग्स में कभी भी बदल सकते हैं।',
    continue: 'जारी रखें', signin_subtitle: 'निर्देशन जारी रखने के लिए साइन इन करें।', email: 'ईमेल', password: 'पासवर्ड',
    forgot_password: 'पासवर्ड भूल गए?', sign_in: 'साइन इन', new_here: 'नए हैं?', create_account: 'खाता बनाएँ',
    create_account_title: 'खाता बनाएँ', signup_subtitle: 'आपकी पहली रील बस 60 सेकंड दूर है।', full_name: 'पूरा नाम',
    have_account: 'पहले से खाता है?', send_reset_link: 'रीसेट लिंक भेजें', reset_password: 'पासवर्ड रीसेट करें',
    new_password: 'नया पासवर्ड', update_password: 'पासवर्ड अपडेट करें', give_reel_name: 'रील का नाम दें',
    type_of_shoot: 'शूट का प्रकार', mood: 'मूड', duration: 'अवधि', platform: 'प्लेटफ़ॉर्म',
    purpose_label: 'यह वीडियो किसलिए है?', purpose_hint: 'बताएँ कि वीडियो में क्या दिखाना है और आप इसे क्यों बना रहे हैं।',
    target_audience: 'लक्षित दर्शक (वैकल्पिक)', create_project: 'प्रोजेक्ट बनाएँ', environment_scan: 'AI से जगह स्कैन करें',
    custom_script: 'आपकी खास स्क्रिप्ट', scene_scan_label: 'AI से जगह स्कैन करें', storyboard: 'शॉट योजना',
    no_purpose: 'कोई उद्देश्य नहीं दिया गया', generate_storyboard: 'AI शॉट योजना बनाएँ',
    directing_your_shoot: 'शूट की योजना बन रही है…', preview_final_reel: 'अंतिम रील देखें',
    reshoot: 'फिर से शूट करें', edit_video_export: 'वीडियो एडिट और एक्सपोर्ट',
    scan_fallback: 'ऑटोमैटिक स्कैन उपलब्ध नहीं था; स्क्रिप्ट आपके विवरण पर आधारित है।',
    clip_filter: 'क्लिप फ़िल्टर', overall_look: 'पूरा वीडियो लुक', title_text: 'शीर्षक टेक्स्ट', sound_mix: 'ऑडियो मिक्स',
    export_format: 'एक्सपोर्ट फ़ॉर्मेट', save_edit: 'एडिट सेव करें', edits_saved: 'एडिट सेव हैं', render_upload_ready: 'अपलोड के लिए वीडियो बनाएँ',
    scan_explainer: 'जहाँ फिल्माना है उसे स्कैन करें। AI दृश्य और आपके विवरण से खास शॉट योजना बनाएगा।',
    camera_access_needed: 'कैमरा एक्सेस ज़रूरी है', scan_permission: 'फिल्माने की जगह स्कैन करने के लिए कैमरा अनुमति दें।', starting_camera: 'कैमरा शुरू हो रहा है…',
    grant_access: 'अनुमति दें', scan_scene: 'दृश्य स्कैन करें', scan_start: 'स्कैन शुरू करें', scan_stop: 'स्कैन रोकें और विश्लेषण करें',
    scan_capture_hint: 'जगह दिखाने के लिए कैमरा धीरे-धीरे घुमाएँ; दो दृश्य काफ़ी हैं।', scan_views_captured: '{count} दृश्य कैप्चर हुए',
    analyzing_scene: 'दृश्य का विश्लेषण हो रहा है…',
    scene_analyzed: 'दृश्य का विश्लेषण पूरा', lighting: 'रोशनी', composition: 'कंपोज़िशन', suggested_shots: 'सुझाए गए शॉट',
    creator_skill_level: 'फिल्म बनाने का आपका अनुभव कितना है?', skill_help: 'आप इसे कभी भी बदल सकते हैं। शुरुआत के लिए Beginner चुनें।',
    beginner: 'शुरुआती', creator: 'क्रिएटर', pro: 'प्रो',
    phase_hook: 'शुरुआत', phase_detail: 'बारीकी', phase_action: 'एक्शन', phase_hero: 'मुख्य दृश्य', phase_cta: 'अंत',
    shot_current: 'अभी', shot_done: 'पूरा', shot_upcoming: 'आगे', shot_retake: 'फिर लें', shot_skipped: 'छोड़ा गया', shot_plan: 'शॉट योजना',
    skip_shot: 'यह शॉट छोड़ें', include_shot: 'यह शॉट शामिल करें',
    storyboard_preserved: 'AI योजना अपडेट नहीं कर पाया। आपकी सेव की हुई शॉट योजना और क्लिप सुरक्षित हैं।',
    all_shots_skipped: 'सभी शॉट छोड़े गए हैं। शूटिंग शुरू करने के लिए एक शामिल करें।',
    scan_again: 'फिर से स्कैन करें', generate_script: 'स्कैन से मेरी स्क्रिप्ट बनाएँ', skip_scan: 'स्कैन के बिना जारी रखें',
    generating_story: 'आपकी खास कहानी लिखी जा रही है…', move_guide: 'मूवमेंट गाइड',
    flashlight: 'फ़्लैशलाइट', brightness: 'ब्राइटनेस', blur: 'धुंधलापन', exposure: 'एक्सपोज़र', framing: 'फ्रेमिंग',
    move_dolly_out: 'पीछे हटें', move_tracking: 'सब्जेक्ट के साथ चलें', move_orbit: 'सब्जेक्ट के चारों ओर जाएँ',
    move_reveal: 'दिखाने के लिए धीरे सरकें', move_handheld: 'धीरे चलें', zoom: 'ज़ूम',
    zoom_unavailable: 'इस कैमरे का ज़ूम अभी नहीं बदला जा सकता।', brightness_up: 'ब्राइटनेस बढ़ाएँ', brightness_down: 'ब्राइटनेस घटाएँ',
    stability: 'स्थिरता', clip_saved: 'क्लिप सेव हुई', rating_pending: 'AI इस शॉट को रेट कर रहा है…', saving_clip: 'आपकी क्लिप सेव हो रही है…', great_shot: 'बहुत अच्छा शॉट!', retake_suggested: 'दोबारा लेना बेहतर होगा',
    retake_required: 'दोबारा शूट करें', your_shot: 'आपका शॉट · फिर से देखें', retake: 'फिर से लें', next_shot: 'अगला शॉट',
    finish_edit: 'पूरा करें और एडिट करें', shot_saved_counter: 'शॉट {current}/{total} सेव हुआ',
    next_shot_counter: 'अगला शॉट · {current}/{total}',
    delete_project: 'प्रोजेक्ट हटाएँ', delete_project_confirm: '“{title}” हटाएँ? इसकी क्लिप, संगीत और एक्सपोर्ट भी हट जाएँगे।',
    delete_project_action: 'हटाएँ', delete_project_failed: 'प्रोजेक्ट हटाया नहीं जा सका। फिर कोशिश करें।',
  },
  es: {
    welcome_back: 'Bienvenido', new_reel: 'Nuevo Reel', dashboard: 'Inicio',
    projects: 'Proyectos', templates: 'Plantillas', profile: 'Perfil',
    start_shooting: 'Empezar', continue_shooting: 'Continuar', prepare_scenes: 'Preparando todas las escenas…',
    ai_scan: 'Escanear con IA', edit_export: 'Editar y exportar',
    render_final: 'Renderizar reel', reel_ready: '¡Tu reel está listo!',
    share_reel: 'Compartir reel',
    choose_language: 'Elige tu idioma', language_subtitle: 'Puedes cambiarlo en cualquier momento en Ajustes.',
    continue: 'Continuar', signin_subtitle: 'Inicia sesión para seguir dirigiendo.', email: 'Correo electrónico', password: 'Contraseña',
    forgot_password: '¿Olvidaste tu contraseña?', sign_in: 'Iniciar sesión', new_here: '¿Eres nuevo?', create_account: 'Crear una cuenta',
    create_account_title: 'Crear cuenta', signup_subtitle: 'Tu primer reel está a 60 segundos.', full_name: 'Nombre completo',
    have_account: '¿Ya tienes una cuenta?', send_reset_link: 'Enviar enlace de restablecimiento', reset_password: 'Restablecer contraseña',
    new_password: 'Nueva contraseña', update_password: 'Actualizar contraseña', give_reel_name: 'Ponle un nombre',
    type_of_shoot: 'Tipo de grabación', mood: 'Estilo', duration: 'Duración', platform: 'Plataforma',
    purpose_label: '¿Para qué es el video?', purpose_hint: 'Describe qué debe mostrar el video y por qué lo estás creando.',
    target_audience: 'Público objetivo (opcional)', create_project: 'Crear proyecto', environment_scan: 'Escaneo del entorno con IA',
    custom_script: 'Tu guion personalizado', scene_scan_label: 'Escaneo del entorno con IA', storyboard: 'Guion gráfico',
    no_purpose: 'Sin propósito', generate_storyboard: 'Crear guion con IA',
    directing_your_shoot: 'Preparando tu grabación…', preview_final_reel: 'Vista previa del reel',
    reshoot: 'Volver a grabar', edit_video_export: 'Editar y exportar',
    scan_fallback: 'El escaneo automático no estaba disponible; el guion usa tu descripción.',
    clip_filter: 'Filtro del clip', overall_look: 'Estilo general', title_text: 'Texto del título', sound_mix: 'Mezcla de audio',
    export_format: 'Formato de exportación', save_edit: 'Guardar edición', edits_saved: 'Ediciones guardadas', render_upload_ready: 'Crear video listo para publicar',
    scan_explainer: 'Escanea el lugar donde grabarás. La IA usará la escena y tu descripción para crear un plan de tomas.',
    camera_access_needed: 'Se necesita acceso a la cámara', scan_permission: 'Permite el acceso para escanear el lugar de grabación.', starting_camera: 'Iniciando cámara…',
    grant_access: 'Permitir acceso', scan_scene: 'Escanear escena', scan_start: 'Iniciar escaneo', scan_stop: 'Detener y analizar',
    scan_capture_hint: 'Gira lentamente para mostrar el espacio; dos vistas son suficientes.', scan_views_captured: '{count} vistas capturadas',
    analyzing_scene: 'Analizando la escena…',
    scene_analyzed: 'Escena analizada', lighting: 'Iluminación', composition: 'Composición', suggested_shots: 'Tomas sugeridas',
    creator_skill_level: '¿Cuánta experiencia tienes filmando?', skill_help: 'Puedes cambiarlo cuando quieras. El nivel principiante es el predeterminado.',
    beginner: 'Principiante', creator: 'Creador', pro: 'Pro',
    phase_hook: 'Gancho', phase_detail: 'Detalle', phase_action: 'Acción', phase_hero: 'Protagonista', phase_cta: 'Final',
    shot_current: 'Actual', shot_done: 'Listo', shot_upcoming: 'Próximo', shot_retake: 'Repetir', shot_skipped: 'Omitido', shot_plan: 'Plan de tomas',
    skip_shot: 'Omitir toma', include_shot: 'Incluir toma',
    storyboard_preserved: 'La IA no pudo actualizar el plan. Tu guion y tus clips guardados siguen intactos.',
    all_shots_skipped: 'Todas las tomas están omitidas. Incluye una para empezar a grabar.',
    scan_again: 'Volver a escanear', generate_script: 'Usar el escaneo y crear mi guion', skip_scan: 'Continuar sin escanear',
    generating_story: 'Creando tu historia personalizada…', move_guide: 'Guía de movimiento',
    flashlight: 'Linterna', brightness: 'Brillo', blur: 'Nitidez', exposure: 'Exposición', framing: 'Encuadre',
    move_dolly_out: 'Aléjate', move_tracking: 'Sigue al sujeto', move_orbit: 'Rodea al sujeto',
    move_reveal: 'Desliza para mostrar', move_handheld: 'Muévete suavemente', zoom: 'Zoom',
    zoom_unavailable: 'Esta cámara no puede cambiar el zoom ahora.', brightness_up: 'Aumentar brillo', brightness_down: 'Reducir brillo',
    stability: 'Estabilidad', clip_saved: 'Clip guardado', rating_pending: 'La IA está valorando esta toma…', saving_clip: 'Guardando el clip…', great_shot: '¡Gran toma!', retake_suggested: 'Se recomienda repetir',
    retake_required: 'Hay que repetir', your_shot: 'Tu toma · volver a verla', retake: 'Repetir', next_shot: 'Siguiente toma',
    finish_edit: 'Finalizar y editar', shot_saved_counter: 'Toma {current} de {total} guardada',
    next_shot_counter: 'Siguiente toma · {current} de {total}',
    delete_project: 'Eliminar proyecto', delete_project_confirm: '¿Eliminar “{title}”? También se eliminarán sus clips, audio y videos exportados.',
    delete_project_action: 'Eliminar', delete_project_failed: 'No se pudo eliminar el proyecto. Inténtalo de nuevo.',
  },
};

const LANG_KEY = 'reeldirector.language';
const ONBOARD_KEY = 'reeldirector.onboarded';

let currentLang = 'en';
let dynamicStrings: Record<string, string> = {};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const fallbackBackend = (Constants.expoConfig?.extra?.backendUrl || '').replace(/\/+$/, '');
const translationRequests = new Map<string, Promise<void>>();
const translationAttempts = new Set<string>();
const TRANSLATION_CACHE_VERSION = 5;

function fetchTranslations(code: string) {
  const active = translationRequests.get(code);
  if (active) return active;
  const request = fetchTranslationsOnce(code).finally(() => translationRequests.delete(code));
  translationRequests.set(code, request);
  return request;
}

async function fetchTranslationsOnce(code: string) {
  if (code === 'en') { dynamicStrings = {}; notify(); return; }
  const cacheKey = `reeldirector.translations.v${TRANSLATION_CACHE_VERSION}.${code}`;
  const cache = await AsyncStorage.getItem(cacheKey);
  if (cache) {
    try {
      const translated = JSON.parse(cache);
      if (translated && typeof translated === 'object' && Object.keys(translated).length) {
        if (currentLang === code) { dynamicStrings = translated; notify(); }
        return;
      }
    } catch { /* Replace a stale or malformed translation cache. */ }
    await AsyncStorage.removeItem(cacheKey).catch(() => {});
  }
  if (!fallbackBackend || translationAttempts.has(code)) return;
  translationAttempts.add(code);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const response = await fetch(`${fallbackBackend}/api/ui/translations/${encodeURIComponent(code)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return;
    const body = await response.json();
    if (body?.translations && typeof body.translations === 'object') {
      const translated = body.translations as Record<string, string>;
      await AsyncStorage.setItem(cacheKey, JSON.stringify(translated));
      if (currentLang === code) { dynamicStrings = translated; notify(); }
    }
  } catch { /* Cached or built-in text stays available offline. */ }
}

export async function getLanguage(): Promise<string> {
  const v = await AsyncStorage.getItem(LANG_KEY);
  currentLang = v || 'en';
  if (currentLang !== 'en' && !Object.keys(dynamicStrings).length) void fetchTranslations(currentLang);
  return currentLang;
}
export async function setLanguage(code: string) {
  currentLang = code;
  dynamicStrings = STRINGS[code] || {};
  await AsyncStorage.setItem(LANG_KEY, code);
  notify();
  translationAttempts.delete(code);
  void fetchTranslations(code);
}
export async function isOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(ONBOARD_KEY)) === '1';
}
export async function markOnboarded() {
  await AsyncStorage.setItem(ONBOARD_KEY, '1');
}
export function t(key: string): string {
  return dynamicStrings[key] || STRINGS[currentLang]?.[key] || STRINGS.en[key] || key;
}
export function useT() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    getLanguage().then(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return t;
}
