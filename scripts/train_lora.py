import argparse
from datasets import load_dataset
from peft import LoraConfig, prepare_model_for_kbit_training
from trl import SFTConfig, SFTTrainer
from transformers import AutoModelForCausalLM, BitsAndBytesConfig
import torch

parser = argparse.ArgumentParser(description="Fine-tune a coding model with a Nexus verified JSONL dataset.")
parser.add_argument("--model", required=True)
parser.add_argument("--train", required=True)
parser.add_argument("--validation")
parser.add_argument("--output", required=True)
args = parser.parse_args()

files = {"train": args.train}
if args.validation:
    files["validation"] = args.validation
dataset = load_dataset("json", data_files=files)

model = args.model
if torch.cuda.is_available():
    try:
        quantization = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
            bnb_4bit_use_double_quant=True,
        )
        model = AutoModelForCausalLM.from_pretrained(args.model, quantization_config=quantization, device_map="auto")
        model = prepare_model_for_kbit_training(model)
    except (ImportError, RuntimeError):
        model = args.model

training = SFTConfig(
    output_dir=args.output,
    num_train_epochs=3,
    learning_rate=2e-4,
    per_device_train_batch_size=1,
    gradient_accumulation_steps=8,
    logging_steps=5,
    save_strategy="epoch",
    report_to="none",
)
lora = LoraConfig(
    r=32,
    lora_alpha=16,
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
    target_modules="all-linear",
)
trainer = SFTTrainer(
    model=model,
    args=training,
    train_dataset=dataset["train"],
    eval_dataset=dataset.get("validation"),
    peft_config=lora,
)
trainer.train()
trainer.save_model(args.output)
